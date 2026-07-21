import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const DEVICE_A = 'e2e-device-a';
const DEVICE_B = 'e2e-device-b';
const DEVICE_OBSERVER = 'e2e-device-observer';
const ENDPOINT_A = 'e2e-endpoint-a';
const ENDPOINT_B = 'e2e-endpoint-b';
const ENDPOINT_OBSERVER = 'e2e-endpoint-observer';

interface PlaybackSessionSnapshot {
    activeDeviceId: string | null;
    activeDeviceSequence: number;
    currentMusicId: string | null;
    revision: number;
    state: 'playing' | 'paused' | 'stopped';
}

interface PlaybackQueueSnapshot {
    musicIds: string[];
    revision: number;
}

interface PlaybackDeviceRegistrySnapshot {
    activeEndpointId: string | null;
    devices: Array<{
        id: string;
        name: string;
        endpoints: Array<{
            id: string;
            online: boolean;
        }>;
    }>;
}

interface CapturedPlaybackReport {
    input: {
        deviceId: string;
        expectedRevision: number;
        claimActive: boolean;
        state: 'playing' | 'paused' | 'stopped';
        currentMusicId: string | null;
    };
    result: {
        type: 'accepted' | 'conflict';
        reason: 'active-device' | 'stale-revision' | 'stale-sequence' | null;
    };
}

const initializePlaybackIdentity = async (
    context: BrowserContext,
    deviceId: string,
    endpointId: string
) => {
    await context.addInitScript(({ installationId, playbackEndpointId }) => {
        localStorage.setItem('ocean-wave-device-id', installationId);
        sessionStorage.setItem('ocean-wave-playback-device-id', playbackEndpointId);
        sessionStorage.setItem('ocean-wave-playback-device-sequence', '0');
        localStorage.setItem('audio-settings', JSON.stringify({
            format: 'mp3',
            bitrate: '128k',
            useOriginal: true
        }));
    }, {
        installationId: deviceId,
        playbackEndpointId: endpointId
    });
};

const graphQL = async <T>(
    page: Page,
    operationName: string,
    query: string,
    variables?: Record<string, unknown>
) => page.evaluate(async ({ requestOperationName, requestQuery, requestVariables }) => {
    const response = await fetch('/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            operationName: requestOperationName,
            query: requestQuery,
            variables: requestVariables
        })
    });
    const payload = await response.json();

    if (!response.ok || payload.errors?.length) {
        throw new Error(JSON.stringify(payload.errors ?? payload));
    }

    return payload.data as T;
}, {
    requestOperationName: operationName,
    requestQuery: query,
    requestVariables: variables
});

const fetchSession = async (page: Page) => {
    const data = await graphQL<{ playbackSession: PlaybackSessionSnapshot | null }>(
        page,
        'E2EPlaybackSession',
        `query E2EPlaybackSession {
            playbackSession {
                activeDeviceId
                activeDeviceSequence
                currentMusicId
                revision
                state
            }
        }`
    );
    return data.playbackSession;
};

const fetchQueue = async (page: Page) => {
    const data = await graphQL<{ playbackQueue: PlaybackQueueSnapshot | null }>(
        page,
        'E2EPlaybackQueue',
        `query E2EPlaybackQueue {
            playbackQueue {
                musicIds
                revision
            }
        }`
    );
    return data.playbackQueue;
};

const fetchRegistry = async (page: Page) => {
    const data = await graphQL<{
        playbackDeviceRegistry: PlaybackDeviceRegistrySnapshot;
    }>(
        page,
        'E2EPlaybackDeviceRegistry',
        `query E2EPlaybackDeviceRegistry {
            playbackDeviceRegistry {
                activeEndpointId
                devices {
                    id
                    name
                    endpoints {
                        id
                        online
                    }
                }
            }
        }`
    );
    return data.playbackDeviceRegistry;
};

const renameDevice = async (page: Page, deviceId: string, name: string) => {
    await graphQL(
        page,
        'E2ERenamePlaybackDevice',
        `mutation E2ERenamePlaybackDevice($input: RenamePlaybackDeviceInput!) {
            renamePlaybackDevice(input: $input) {
                deviceId
                name
            }
        }`,
        { input: { deviceId, name } }
    );
};

const endpointIsOnline = (
    registry: PlaybackDeviceRegistrySnapshot,
    endpointId: string
) => registry.devices.some(device => device.endpoints.some(endpoint => (
    endpoint.id === endpointId && endpoint.online
)));

const trackButton = (page: Page, name: string) => page.locator('button').filter({
    hasText: name
}).first();

test('keeps playback and queue authority consistent through offline reconnect', async ({
    browser
}) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const contextObserver = await browser.newContext();
    await initializePlaybackIdentity(contextA, DEVICE_A, ENDPOINT_A);
    await initializePlaybackIdentity(contextB, DEVICE_B, ENDPOINT_B);
    await initializePlaybackIdentity(
        contextObserver,
        DEVICE_OBSERVER,
        ENDPOINT_OBSERVER
    );

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const observerPage = await contextObserver.newPage();

    try {
        const observerInitialQueueRead = observerPage.waitForResponse((response) => {
            const request = response.request();
            return request.url().endsWith('/graphql')
                && request.postData()?.includes('"operationName":"PlaybackQueue"') === true;
        });
        await Promise.all([
            pageA.goto('/library'),
            pageB.goto('/library'),
            observerPage.goto('/library')
        ]);
        await Promise.all([
            expect(trackButton(pageA, 'Reconnect Track One')).toBeVisible(),
            expect(trackButton(pageB, 'Reconnect Track One')).toBeVisible(),
            expect(trackButton(observerPage, 'Reconnect Track One')).toBeVisible(),
            observerInitialQueueRead
        ]);

        await expect.poll(async () => endpointIsOnline(
            await fetchRegistry(pageB),
            ENDPOINT_A
        )).toBe(true);
        await expect.poll(async () => endpointIsOnline(
            await fetchRegistry(pageA),
            ENDPOINT_B
        )).toBe(true);

        await renameDevice(pageA, DEVICE_A, 'Browser A');
        await renameDevice(pageB, DEVICE_B, 'Browser B');

        await trackButton(pageA, 'Reconnect Track One').click();
        await expect.poll(async () => {
            const session = await fetchSession(pageB);
            return session && {
                activeDeviceId: session.activeDeviceId,
                currentMusicId: session.currentMusicId,
                state: session.state
            };
        }).toEqual({
            activeDeviceId: ENDPOINT_A,
            currentMusicId: '1',
            state: 'playing'
        });
        await expect.poll(async () => (await fetchQueue(pageB))?.musicIds).toEqual(['1']);

        const libraryPlaybackSurface = pageB.getByRole('region', {
            name: 'Current playback and continue listening'
        });
        await expect(libraryPlaybackSurface).toContainText('Playing on Browser A');
        await expect(libraryPlaybackSurface).toContainText('Browser A · Online');
        await expect(libraryPlaybackSurface.getByRole('group', {
            name: 'Remote playback controls for Browser A'
        })).toBeVisible();
        await expect(libraryPlaybackSurface.getByRole('button', {
            name: 'Play Here'
        })).toBeVisible();
        const pauseBrowserA = libraryPlaybackSurface.getByRole('button', {
            name: 'Pause playback on Browser A'
        });
        await expect(pauseBrowserA).toBeEnabled({ timeout: 15_000 });
        await pauseBrowserA.click();
        await expect.poll(async () => (await fetchSession(pageB))?.state).toBe('paused');
        await libraryPlaybackSurface.getByRole('button', {
            name: 'Resume playback on Browser A'
        }).click();
        await expect.poll(async () => (await fetchSession(pageB))?.state).toBe('playing');

        const beforeDisconnectSession = await fetchSession(pageB);
        const beforeDisconnectQueue = await fetchQueue(pageB);
        expect(beforeDisconnectSession).not.toBeNull();
        expect(beforeDisconnectQueue).not.toBeNull();

        await contextA.setOffline(true);
        await expect.poll(async () => endpointIsOnline(
            await fetchRegistry(pageB),
            ENDPOINT_A
        )).toBe(false);
        // A trailing report can settle while offline status propagates.
        const disconnectBoundarySession = await fetchSession(pageB);
        expect(disconnectBoundarySession).not.toBeNull();
        expect(disconnectBoundarySession!.revision)
            .toBeGreaterThanOrEqual(beforeDisconnectSession!.revision);

        await trackButton(pageA, 'Reconnect Track Two').click();
        await pageA.getByRole('button', { name: 'Open queue' }).click();
        await expect(pageA).toHaveURL(/\/queue$/);
        await expect(pageA.getByText('Reconnect Track Two', { exact: true })).toBeVisible();
        await pageA.waitForTimeout(1_500);

        await expect(libraryPlaybackSurface).toContainText('Browser A · Offline');
        await expect(libraryPlaybackSurface.getByRole('button', {
            name: 'Pause playback on Browser A'
        })).toBeDisabled();
        await pageB.getByRole('button', {
            name: /Playback output: Browser A, Offline\. Open device list/
        }).click();
        const playbackOutputDialog = pageB.getByRole('dialog', {
            name: 'Playback output'
        });
        await playbackOutputDialog.getByRole('button', { name: 'Play Here' }).click();
        const forcePlayHere = playbackOutputDialog.getByRole('button', {
            name: 'Force Play Here'
        });
        await expect(forcePlayHere).toBeVisible();
        await forcePlayHere.click();

        await expect.poll(async () => {
            const session = await fetchSession(pageB);
            return session && {
                activeDeviceId: session.activeDeviceId,
                currentMusicId: session.currentMusicId,
                state: session.state
            };
        }).toEqual({
            activeDeviceId: ENDPOINT_B,
            currentMusicId: '1',
            state: 'playing'
        });
        await expect(pageB.getByRole('button', { name: 'Pause playback' })).toBeVisible();

        await trackButton(pageB, 'Reconnect Track Three').click();
        await expect.poll(async () => (await fetchQueue(pageB))?.musicIds).toEqual(['1', '3']);

        const reconnectReports: CapturedPlaybackReport[] = [];
        pageA.on('response', async (response) => {
            const request = response.request();
            const postData = request.postData();
            if (
                !request.url().endsWith('/graphql')
                || !postData?.includes('ReportPlaybackState')
            ) {
                return;
            }

            try {
                const requestPayload = JSON.parse(postData) as {
                    operationName?: string;
                    variables?: { input?: CapturedPlaybackReport['input'] };
                };
                if (
                    requestPayload.operationName !== 'ReportPlaybackState'
                    || !requestPayload.variables?.input
                ) {
                    return;
                }
                const responsePayload = await response.json() as {
                    data?: {
                        reportPlaybackState?: {
                            type: CapturedPlaybackReport['result']['type'];
                            conflict?: {
                                reason: NonNullable<
                                    CapturedPlaybackReport['result']['reason']
                                >;
                            } | null;
                        };
                    };
                };
                const result = responsePayload.data?.reportPlaybackState;
                if (result) {
                    reconnectReports.push({
                        input: requestPayload.variables.input,
                        result: {
                            type: result.type,
                            reason: result.conflict?.reason ?? null
                        }
                    });
                }
            } catch {
                // Navigation or shutdown can dispose a response before it is read.
            }
        });

        await contextA.setOffline(false);
        await expect.poll(async () => endpointIsOnline(
            await fetchRegistry(pageB),
            ENDPOINT_A
        )).toBe(true);
        await expect.poll(() => reconnectReports.some(report => (
            report.input.deviceId === ENDPOINT_A
            && report.input.expectedRevision >= beforeDisconnectSession!.revision
            && report.input.expectedRevision <= disconnectBoundarySession!.revision
            && report.input.claimActive === false
            && report.input.state === 'paused'
            && report.input.currentMusicId === '1'
            && report.result.type === 'conflict'
            && report.result.reason === 'active-device'
        ))).toBe(true);
        await expect.poll(async () => (await fetchSession(pageB))?.activeDeviceId).toBe(ENDPOINT_B);

        await expect(pageA.getByRole('alert')).toContainText(
            'Current playback will continue until you choose.'
        );
        await expect(pageA.getByRole('button', { name: 'Keep newer queue' })).toBeVisible();
        await expect(pageA.getByRole('button', {
            name: 'Replace with this queue'
        })).toBeVisible();
        await expect(pageA.getByText('Reconnect Track Two', { exact: true })).toBeVisible();
        await pageA.getByRole('button', { name: 'Keep newer queue' }).click();
        await expect(pageA.getByText('Reconnect Track Three', { exact: true })).toBeVisible();
        await expect(pageA.getByText('Reconnect Track Two', { exact: true })).toHaveCount(0);

        await pageA.getByRole('button', { name: 'Open controls' }).click();
        await expect(pageA).toHaveURL(/\/player$/);
        await expect(pageA.getByRole('group', {
            name: 'Remote playback controls for Browser B'
        })).toBeVisible();
        const pauseBrowserB = pageA.getByRole('button', {
            name: 'Pause playback on Browser B'
        });
        const retryControllerRefresh = pageA.getByRole('button', {
            name: 'Retry refresh'
        });
        await expect.poll(async () => (
            await pauseBrowserB.isEnabled()
            || await retryControllerRefresh.isVisible()
        )).toBe(true);
        if (!await pauseBrowserB.isEnabled()) {
            await retryControllerRefresh.click();
        }
        await expect(pauseBrowserB).toBeEnabled();
        await pauseBrowserB.click();
        await expect.poll(async () => (await fetchSession(pageB))?.state).toBe('paused');
        await expect(pageA.getByRole('button', {
            name: 'Resume playback on Browser B'
        })).toBeVisible();
        await expect(pageB.getByRole('button', {
            name: 'Resume playback',
            exact: true
        }).first()).toBeVisible();

        await Promise.all([
            pageA.getByRole('button', { name: /^Open queue/ }).first().click(),
            pageB.getByRole('button', { name: /^Open queue/ }).first().click()
        ]);
        await Promise.all([
            expect(pageA).toHaveURL(/\/queue$/),
            expect(pageB).toHaveURL(/\/queue$/)
        ]);
        for (const page of [pageA, pageB]) {
            const queueItems = page.locator('li[data-queue-index]');
            await expect(queueItems).toHaveCount(2);
            await expect(queueItems.nth(0)).toContainText('Reconnect Track One');
            await expect(queueItems.nth(1)).toContainText('Reconnect Track Three');
            await expect(queueItems.filter({
                hasText: 'Reconnect Track Two'
            })).toHaveCount(0);
        }

        const [sessionFromA, sessionFromB, queueFromA, queueFromB] = await Promise.all([
            fetchSession(pageA),
            fetchSession(pageB),
            fetchQueue(pageA),
            fetchQueue(pageB)
        ]);

        expect(sessionFromA).toEqual(sessionFromB);
        expect(sessionFromA?.activeDeviceId).toBe(ENDPOINT_B);
        expect(sessionFromA?.revision).toBeGreaterThan(beforeDisconnectSession!.revision);
        expect(queueFromA).toEqual(queueFromB);
        expect(queueFromA?.musicIds).toEqual(['1', '3']);
        expect(queueFromA?.revision).toBeGreaterThan(beforeDisconnectQueue!.revision);

        await pageB.goto('/player');
        await pageB.getByRole('button', { name: 'Stop playback' }).click();
        await expect.poll(async () => (await fetchSession(observerPage))?.state)
            .toBe('stopped');

        const observerSurface = observerPage.getByRole('region', {
            name: 'Current playback and continue listening'
        });
        await expect(observerSurface).toContainText('Continue listening');
        await expect(observerSurface).toContainText('Reconnect Track One');
        await expect(observerSurface).toContainText('Saved queue · 1 of 2 tracks');
        await expect(observerSurface.getByRole('button', {
            name: 'Play Here'
        })).toBeVisible();
    } finally {
        await contextA.close().catch(() => undefined);
        await contextB.close().catch(() => undefined);
        await contextObserver.close().catch(() => undefined);
    }
});
