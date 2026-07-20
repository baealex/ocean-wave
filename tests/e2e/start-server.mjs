import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '../..');
const serverDirectory = path.join(repositoryRoot, 'packages/server');
const runId = process.env.OCEAN_WAVE_E2E_RUN_ID ?? `standalone-${process.pid}`;
if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
    throw new Error('OCEAN_WAVE_E2E_RUN_ID contains unsupported characters.');
}
const runtimeDirectory = path.join(repositoryRoot, '.e2e', runId);
const databasePath = path.join(runtimeDirectory, 'ocean-wave.sqlite3');
const musicDirectory = path.join(runtimeDirectory, 'music');
const cacheDirectory = path.join(runtimeDirectory, 'cache');
const port = Number(process.env.OCEAN_WAVE_E2E_PORT ?? '44210');
if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error('OCEAN_WAVE_E2E_PORT must be a valid non-privileged port.');
}
const databaseUrl = `file:${databasePath}`;

const createWaveFixture = (filePath) => {
    const durationSeconds = 90;
    const sampleRate = 8_000;
    const channelCount = 1;
    const bytesPerSample = 2;
    const sampleCount = durationSeconds * sampleRate;
    const dataSize = sampleCount * channelCount * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channelCount, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
    buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
    buffer.writeUInt16LE(bytesPerSample * 8, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    for (let sample = 0; sample < sampleCount; sample += 1) {
        const value = Math.sin(2 * Math.PI * 220 * sample / sampleRate) * 1_200;
        buffer.writeInt16LE(Math.round(value), 44 + sample * bytesPerSample);
    }

    fs.writeFileSync(filePath, buffer);
};

const prepareRuntime = () => {
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
    fs.mkdirSync(musicDirectory, { recursive: true });
    fs.mkdirSync(cacheDirectory, { recursive: true });
    createWaveFixture(path.join(musicDirectory, 'reconnect-fixture.wav'));
};

const migrateDatabase = (environment) => {
    const migration = spawnSync(
        'pnpm',
        ['exec', 'prisma', 'migrate', 'deploy'],
        {
            cwd: serverDirectory,
            env: environment,
            stdio: 'inherit'
        }
    );

    if (migration.status !== 0) {
        process.exit(migration.status ?? 1);
    }
};

const seedDatabase = () => {
    const requireFromServer = createRequire(path.join(serverDirectory, 'package.json'));
    const Database = requireFromServer('better-sqlite3');
    const database = new Database(databasePath);

    try {
        database.exec(`
            INSERT INTO "Artist" (
                "id", "name", "createdAt", "updatedAt"
            ) VALUES (
                1, 'E2E Artist', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            );

            INSERT INTO "Album" (
                "id", "name", "cover", "publishedYear", "artistId",
                "createdAt", "updatedAt"
            ) VALUES (
                1, 'Reconnect Fixtures', '', '2026', 1,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            );

            INSERT INTO "Music" (
                "id", "name", "albumId", "artistId", "filePath", "duration",
                "codec", "container", "bitrate", "sampleRate", "trackNumber",
                "lastSeenAt", "syncStatus", "createdAt", "updatedAt"
            ) VALUES
                (
                    1, 'Reconnect Track One', 1, 1, 'reconnect-fixture.wav', 90,
                    'pcm_s16le', 'wav', 128000, 8000, 1,
                    CURRENT_TIMESTAMP, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                ),
                (
                    2, 'Reconnect Track Two', 1, 1, 'reconnect-fixture.wav', 90,
                    'pcm_s16le', 'wav', 128000, 8000, 2,
                    CURRENT_TIMESTAMP, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                ),
                (
                    3, 'Reconnect Track Three', 1, 1, 'reconnect-fixture.wav', 90,
                    'pcm_s16le', 'wav', 128000, 8000, 3,
                    CURRENT_TIMESTAMP, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                );
        `);
    } finally {
        database.close();
    }
};

prepareRuntime();

const environment = {
    ...process.env,
    PORT: port.toString(),
    DATABASE_URL: databaseUrl,
    OCEAN_WAVE_ALLOW_INSECURE_NO_AUTH: 'true',
    OCEAN_WAVE_MUSIC_PATH: musicDirectory,
    OCEAN_WAVE_CACHE_PATH: cacheDirectory
};

migrateDatabase(environment);
seedDatabase();

const server = spawn('pnpm', ['exec', 'ts-node', 'src/main.ts'], {
    cwd: serverDirectory,
    env: environment,
    stdio: 'inherit'
});

let stopping = false;

const cleanupRuntime = () => {
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
};

const stopServer = (signal) => {
    if (stopping) {
        return;
    }

    stopping = true;

    if (!server.killed) {
        server.kill(signal);
    }
};

process.on('SIGINT', () => stopServer('SIGINT'));
process.on('SIGTERM', () => stopServer('SIGTERM'));
process.on('SIGHUP', () => stopServer('SIGHUP'));
process.on('exit', cleanupRuntime);
server.on('error', (error) => {
    console.error('Failed to start the E2E server.', error);
    cleanupRuntime();
    process.exit(1);
});
server.on('exit', (code) => {
    cleanupRuntime();
    process.exit(stopping ? 0 : (code ?? 1));
});
