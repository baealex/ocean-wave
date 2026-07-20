import { defineConfig, devices } from '@playwright/test';

const configuredPort = process.env.OCEAN_WAVE_E2E_PORT;
const port = configuredPort
    ? Number(configuredPort)
    : 10_000 + process.pid % 50_000;
if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error('OCEAN_WAVE_E2E_PORT must be a valid non-privileged port.');
}
const runId = process.env.OCEAN_WAVE_E2E_RUN_ID ?? `playwright-${process.pid}`;
// Playwright reloads this config in workers, which inherit the parent environment.
process.env.OCEAN_WAVE_E2E_PORT = port.toString();
process.env.OCEAN_WAVE_E2E_RUN_ID = runId;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    workers: 1,
    timeout: 90_000,
    expect: {
        timeout: 10_000
    },
    reporter: process.env.CI
        ? [['line'], ['html', { open: 'never' }]]
        : 'list',
    use: {
        baseURL,
        trace: 'retain-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                launchOptions: {
                    args: ['--autoplay-policy=no-user-gesture-required']
                }
            }
        }
    ],
    webServer: {
        command: 'pnpm build:client && node tests/e2e/start-server.mjs',
        env: {
            OCEAN_WAVE_E2E_PORT: port.toString(),
            OCEAN_WAVE_E2E_RUN_ID: runId
        },
        gracefulShutdown: {
            signal: 'SIGTERM',
            timeout: 10_000
        },
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000
    }
});
