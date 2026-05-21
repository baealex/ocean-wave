#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const image = process.env.SMOKE_IMAGE || 'baealex/ocean-wave:latest';
const port = process.env.SMOKE_PORT || '44180';
const containerName = `ocean-wave-smoke-${process.pid}`;
const workspace = mkdtempSync(path.join(tmpdir(), 'ocean-wave-smoke-'));
const volumePaths = ['music', 'cache', 'data'].map((name) => path.join(workspace, name));
let containerStarted = false;

for (const volumePath of volumePaths) {
    mkdirSync(volumePath, { recursive: true });
}

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

const request = (pathname) => fetch(`http://127.0.0.1:${port}${pathname}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(2000),
});

const waitForHttp = async () => {
    const deadline = Date.now() + 30_000;
    let lastError;

    while (Date.now() < deadline) {
        try {
            const response = await request('/api/auth/session');
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

const cleanup = () => {
    spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
    rmSync(workspace, { recursive: true, force: true });
};

process.on('exit', cleanup);
process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
});

try {
    run('docker', ['--version']);

    const containerId = run('docker', [
        'run',
        '-d',
        '--rm',
        '--name', containerName,
        '-p', `127.0.0.1:${port}:44100`,
        '-e', 'OCEAN_WAVE_ALLOW_INSECURE_NO_AUTH=true',
        '-e', 'OCEAN_WAVE_MUSIC_PATH=/music',
        '-e', 'OCEAN_WAVE_CACHE_PATH=/cache',
        '-e', 'DATABASE_URL=file:/data/db.sqlite3',
        '-v', `${path.join(workspace, 'music')}:/music`,
        '-v', `${path.join(workspace, 'cache')}:/cache`,
        '-v', `${path.join(workspace, 'data')}:/data`,
        image,
    ]);
    containerStarted = true;

    const sessionResponse = await waitForHttp();
    const session = await sessionResponse.json();

    if (session.mode !== 'open' || session.authenticated !== true) {
        throw new Error(`unexpected auth session response: ${JSON.stringify(session)}`);
    }

    const appResponse = await request('/');
    const appHtml = await appResponse.text();

    if (appResponse.status !== 200 || !appHtml.includes('Ocean Wave')) {
        throw new Error(`unexpected app response: status=${appResponse.status}`);
    }

    process.stdout.write(`Docker server smoke passed for ${image} (${containerId.slice(0, 12)})\n`);
} catch (error) {
    const logs = containerStarted
        ? spawnSync('docker', ['logs', containerName], {
            encoding: 'utf8',
            stdio: 'pipe',
        })
        : { stdout: '', stderr: '' };

    if (logs.stdout || logs.stderr) {
        process.stderr.write('\n--- container logs ---\n');
        process.stderr.write(`${logs.stdout ?? ''}${logs.stderr ?? ''}`);
        process.stderr.write('\n--- end container logs ---\n');
    }

    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
}
