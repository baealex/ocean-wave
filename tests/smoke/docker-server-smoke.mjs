#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const image = process.env.SMOKE_IMAGE || 'baealex/ocean-wave:latest';
const basePort = Number(process.env.SMOKE_PORT || '44180');
const passwordModePassword = process.env.SMOKE_AUTH_PASSWORD || `ocean-wave-smoke-${process.pid}`;
const passwordModeSessionSecret = process.env.SMOKE_SESSION_SECRET || `ocean-wave-smoke-session-${process.pid}`;
const activeContainers = new Set();
const workspaces = new Set();

const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        stdio: options.stdio || 'pipe',
        ...options,
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        const stderr = result.stderr ? `\n${result.stderr.trim()}` : '';
        const stdout = result.stdout ? `\n${result.stdout.trim()}` : '';
        throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}${stderr}${stdout}`);
    }

    return result.stdout?.trim() ?? '';
};

const request = (origin, pathname, options = {}) => fetch(`${origin}${pathname}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(2000),
    ...options,
});

const readJson = async (response) => {
    const text = await response.text();

    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`expected JSON response, got: ${text.slice(0, 500)}`);
    }
};

const expectResponse = async (response, expectedStatus, context) => {
    if (response.status !== expectedStatus) {
        const body = await response.text();
        throw new Error(`${context} returned ${response.status}, expected ${expectedStatus}: ${body.slice(0, 500)}`);
    }
};

const getSetCookieHeaders = (headers) => {
    if (typeof headers.getSetCookie === 'function') {
        return headers.getSetCookie();
    }

    const header = headers.get('set-cookie');
    return header ? [header] : [];
};

const createCookieHeader = (headers) => {
    return getSetCookieHeaders(headers)
        .map((cookie) => cookie.split(';', 1)[0])
        .filter(Boolean)
        .join('; ');
};

const expectSession = async (origin, expected, cookieHeader) => {
    const response = await request(origin, '/api/auth/session', {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
    await expectResponse(response, 200, 'GET /api/auth/session');
    const session = await readJson(response);

    for (const [key, value] of Object.entries(expected)) {
        if (session[key] !== value) {
            throw new Error(`unexpected auth session response: ${JSON.stringify(session)}`);
        }
    }

    return session;
};

const expectAppShell = async (origin, cookieHeader) => {
    const response = await request(origin, '/', {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
    const appHtml = await response.text();

    if (response.status !== 200 || !appHtml.includes('Ocean Wave')) {
        throw new Error(`unexpected app response: status=${response.status}`);
    }
};

const expectGraphqlListQuery = async (origin, cookieHeader) => {
    const response = await request(origin, '/graphql', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
        body: JSON.stringify({ query: 'query DockerSmokeMusicList { allMusics { id name } }' }),
    });
    await expectResponse(response, 200, 'POST /graphql');
    const payload = await readJson(response);

    if (payload.errors?.length) {
        throw new Error(`unexpected GraphQL errors: ${JSON.stringify(payload.errors)}`);
    }

    if (!Array.isArray(payload.data?.allMusics)) {
        throw new Error(`unexpected GraphQL list response: ${JSON.stringify(payload)}`);
    }
};

const waitForHttp = async (origin) => {
    const deadline = Date.now() + 30_000;
    let lastError;

    while (Date.now() < deadline) {
        try {
            const response = await request(origin, '/api/auth/session');
            if (response.status === 200) {
                return response;
            }
            lastError = new Error(`unexpected status ${response.status}`);
        } catch (error) {
            lastError = error;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw lastError ?? new Error('server did not respond before timeout');
};

const createScenarioWorkspace = (scenarioName) => {
    const workspace = mkdtempSync(path.join(tmpdir(), `ocean-wave-smoke-${scenarioName}-`));
    workspaces.add(workspace);

    for (const volumeName of ['music', 'cache', 'data']) {
        mkdirSync(path.join(workspace, volumeName), { recursive: true });
    }

    return workspace;
};

const startContainer = ({ scenarioName, port, env }) => {
    const workspace = createScenarioWorkspace(scenarioName);
    const containerName = `ocean-wave-smoke-${scenarioName}-${process.pid}`;
    const dockerEnvArgs = Object.entries({
        ...env,
        OCEAN_WAVE_MUSIC_PATH: '/music',
        OCEAN_WAVE_CACHE_PATH: '/cache',
        DATABASE_URL: 'file:/data/db.sqlite3',
    }).flatMap(([key, value]) => ['-e', `${key}=${value}`]);

    const containerId = run('docker', [
        'run',
        '-d',
        '--rm',
        '--name', containerName,
        '-p', `127.0.0.1:${port}:44100`,
        ...dockerEnvArgs,
        '-v', `${path.join(workspace, 'music')}:/music`,
        '-v', `${path.join(workspace, 'cache')}:/cache`,
        '-v', `${path.join(workspace, 'data')}:/data`,
        image,
    ]);

    activeContainers.add(containerName);

    return {
        containerId,
        containerName,
        origin: `http://127.0.0.1:${port}`,
        workspace,
    };
};

const stopContainer = (containerName) => {
    spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
    activeContainers.delete(containerName);
};

const removeWorkspace = (workspace) => {
    rmSync(workspace, { recursive: true, force: true });
    workspaces.delete(workspace);
};

const cleanup = () => {
    for (const containerName of activeContainers) {
        spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
    }

    for (const workspace of workspaces) {
        rmSync(workspace, { recursive: true, force: true });
    }
};

process.on('exit', cleanup);
process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
});

const runSmokeScenario = async ({ scenarioName, port, env, smoke }) => {
    let container;

    try {
        container = startContainer({ scenarioName, port, env });
        await waitForHttp(container.origin);
        await smoke(container.origin);
        process.stdout.write(`Docker ${scenarioName} smoke passed for ${image} (${container.containerId.slice(0, 12)})\n`);
    } catch (error) {
        if (container) {
            const logs = spawnSync('docker', ['logs', container.containerName], {
                encoding: 'utf8',
                stdio: 'pipe',
            });

            if (logs.stdout || logs.stderr) {
                process.stderr.write(`\n--- ${scenarioName} container logs ---\n`);
                process.stderr.write(`${logs.stdout ?? ''}${logs.stderr ?? ''}`);
                process.stderr.write(`\n--- end ${scenarioName} container logs ---\n`);
            }
        }

        throw error;
    } finally {
        if (container) {
            stopContainer(container.containerName);
            removeWorkspace(container.workspace);
        }
    }
};

const runOpenModeSmoke = () => runSmokeScenario({
    scenarioName: 'open-mode',
    port: basePort,
    env: {
        OCEAN_WAVE_ALLOW_INSECURE_NO_AUTH: 'true',
    },
    smoke: async (origin) => {
        await expectSession(origin, {
            mode: 'open',
            authRequired: false,
            authenticated: false,
        });
        await expectAppShell(origin);
        await expectGraphqlListQuery(origin);
    },
});

const runPasswordModeSmoke = () => runSmokeScenario({
    scenarioName: 'password-mode',
    port: basePort + 1,
    env: {
        OCEAN_WAVE_AUTH_PASSWORD: passwordModePassword,
        OCEAN_WAVE_SESSION_SECRET: passwordModeSessionSecret,
    },
    smoke: async (origin) => {
        await expectSession(origin, {
            mode: 'password',
            authRequired: true,
            authenticated: false,
        });

        const protectedRoot = await request(origin, '/');
        await expectResponse(protectedRoot, 303, 'GET / before login');

        const redirectLocation = protectedRoot.headers.get('location');
        if (redirectLocation !== '/login?redirectTo=%2F') {
            throw new Error(`unexpected root redirect location: ${redirectLocation}`);
        }

        const loginPage = await request(origin, redirectLocation);
        await expectResponse(loginPage, 200, 'GET /login');
        const loginHtml = await loginPage.text();
        if (!loginHtml.includes('<form method="post" action="/login">')) {
            throw new Error('login page did not include the password form');
        }

        const loginResponse = await request(origin, '/login', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                password: passwordModePassword,
                redirectTo: '/',
            }),
        });
        await expectResponse(loginResponse, 303, 'POST /login');

        if (loginResponse.headers.get('location') !== '/') {
            throw new Error(`unexpected login redirect location: ${loginResponse.headers.get('location')}`);
        }

        const cookieHeader = createCookieHeader(loginResponse.headers);
        if (!cookieHeader) {
            throw new Error('login response did not set an auth cookie');
        }

        await expectSession(origin, {
            mode: 'password',
            authRequired: true,
            authenticated: true,
        }, cookieHeader);
        await expectGraphqlListQuery(origin, cookieHeader);
        await expectAppShell(origin, cookieHeader);
    },
});

try {
    run('docker', ['--version']);

    await runOpenModeSmoke();
    await runPasswordModeSmoke();

    process.stdout.write(`Docker server smoke passed for ${image}\n`);
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
}
