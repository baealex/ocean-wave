import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const appOrigin = process.env.OCEAN_WAVE_RUNTIME_ORIGIN ?? 'http://127.0.0.1:5175';
const serverOrigin = process.env.OCEAN_WAVE_RUNTIME_SERVER_ORIGIN ?? 'http://127.0.0.1:44100';
const appUrl = new URL(appOrigin);
const serverUrl = new URL(serverOrigin);
const appHost = appUrl.hostname || '127.0.0.1';
const appPort = appUrl.port || '5175';
const serverPort = serverUrl.port || '44100';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async (args, options = {}) => {
    const child = spawn(pnpmCommand, args, {
        cwd: repoRoot,
        env: {
            ...process.env,
            ...options.env
        },
        stdio: 'inherit'
    });
    const [code, signal] = await once(child, 'exit');

    if (code !== 0) {
        throw new Error(`${pnpmCommand} ${args.join(' ')} failed with ${signal ?? code}`);
    }
};

const startService = (name, args, env) => {
    const child = spawn(pnpmCommand, args, {
        cwd: repoRoot,
        detached: process.platform !== 'win32',
        env: {
            ...process.env,
            ...env
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
    child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));

    return child;
};

const stopService = async (child) => {
    if (!child || child.exitCode !== null) {
        return;
    }

    if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, 'SIGTERM');
    } else {
        child.kill('SIGTERM');
    }

    await Promise.race([
        once(child, 'exit'),
        sleep(3_000)
    ]);

    if (child.exitCode === null) {
        if (process.platform !== 'win32' && child.pid) {
            process.kill(-child.pid, 'SIGKILL');
        } else {
            child.kill('SIGKILL');
        }
    }
};

const waitForHttp = async (url, description, timeoutMs = 45_000) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url);

            if (response.ok) {
                return response;
            }
        } catch {
            // The managed service may still be booting.
        }

        await sleep(500);
    }

    throw new Error(`Timed out waiting for ${description} at ${url}`);
};

const hasReusableRuntimeApp = async () => {
    try {
        const response = await fetch(`${appOrigin}/graphql`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: '{ allMusics { id } allTags(pagination: { limit: 1, offset: 0 }) { totalCount } }' })
        });

        if (!response.ok) {
            return false;
        }

        const payload = await response.json();

        return Boolean(payload.data?.allMusics?.length) && payload.data.allTags.totalCount > 0;
    } catch {
        return false;
    }
};

const waitForRuntimeSeed = async (timeoutMs = 45_000) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (await hasReusableRuntimeApp()) {
            return;
        }

        await sleep(500);
    }

    throw new Error(`Timed out waiting for seeded runtime GraphQL data at ${appOrigin}/graphql`);
};

const resolveChromePath = async () => {
    const candidates = [
        process.env.CHROME_PATH,
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // Try the next known install path.
        }
    }

    return process.env.CHROME_PATH;
};

const runRuntimeSmoke = async () => {
    const chromePath = await resolveChromePath();

    await run(['test:runtime-ui'], {
        env: {
            CHROME_PATH: chromePath,
            OCEAN_WAVE_RUNTIME_ORIGIN: appOrigin
        }
    });
};

const main = async () => {
    if (await hasReusableRuntimeApp()) {
        await runRuntimeSmoke();
        return;
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ocean-wave-runtime-ci-'));
    const databaseUrl = `file:${path.join(tempDir, 'runtime-ui.sqlite3')}`;
    const managedEnv = {
        DATABASE_URL: databaseUrl,
        OCEAN_WAVE_SERVER_ORIGIN: serverOrigin,
        OCEAN_WAVE_ALLOW_INSECURE_NO_AUTH: 'true',
        PORT: serverPort
    };
    const services = [];

    try {
        await run(['--dir', 'packages/server', 'exec', 'prisma', 'migrate', 'deploy'], { env: managedEnv });
        await run(['--dir', 'packages/server', 'exec', 'ts-node', 'script/seed-runtime-ui.ts'], { env: managedEnv });

        services.push(startService('server', ['--dir', 'packages/server', 'exec', 'ts-node', 'src/main.ts'], managedEnv));
        await waitForHttp(`${serverOrigin}/api/auth/session`, 'Ocean Wave server');

        services.push(startService('client', ['--dir', 'packages/client', 'exec', 'vite', '--host', appHost, '--port', appPort], {
            OCEAN_WAVE_SERVER_ORIGIN: serverOrigin
        }));
        await waitForHttp(appOrigin, 'Ocean Wave client');
        await waitForRuntimeSeed();

        await runRuntimeSmoke();
    } finally {
        await Promise.allSettled(services.map(stopService));
        await rm(tempDir, {
            force: true,
            recursive: true
        });
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
