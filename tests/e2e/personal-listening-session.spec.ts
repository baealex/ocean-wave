import { expect, test, type Page } from '@playwright/test';

const queue = (revision: number, musicIds: string[]) => ({
    id: 'personal-session-queue',
    musicIds,
    sourceMusicIds: [],
    currentIndex: 0,
    contextType: 'queue',
    contextId: null,
    contextTitle: null,
    shuffle: false,
    repeatMode: 'none',
    revision,
    updatedAt: '2026-07-21T00:00:00.000Z'
});

const sessionItems = (musicIds: string[]) => musicIds.map((musicId, index) => ({
    musicId,
    reasonCodes: index === 0 ? ['START_TRACK'] : ['SAME_ALBUM', 'SAME_ARTIST']
}));

const mockSessionMutation = async (page: Page) => {
    let requestCount = 0;

    await page.route('**/graphql', async (route) => {
        const payload = route.request().postDataJSON();
        const operationName = payload?.operationName;

        if (operationName === 'ReportPlaybackState') {
            const input = payload.variables.input;
            const observedAt = input.observedAt as string;

            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        reportPlaybackState: {
                            type: 'accepted',
                            session: {
                                id: 'personal-session-playback',
                                state: input.state,
                                activeDeviceId: input.deviceId,
                                activeDeviceSequence: input.sequence,
                                currentMusicId: input.currentMusicId,
                                positionMs: input.positionMs,
                                positionUpdatedAt: observedAt,
                                startedAt: observedAt,
                                revision: input.expectedRevision + 1,
                                serverTime: observedAt
                            },
                            conflict: null
                        }
                    }
                })
            });
            return;
        }

        if (operationName !== 'CreatePersonalListeningSession') {
            await route.continue();
            return;
        }

        requestCount += 1;
        const isConflict = requestCount === 2;
        const musicIds = requestCount < 3 ? ['1', '2'] : ['1', '3'];
        const snapshot = queue(49 + requestCount, musicIds);

        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                data: {
                    createPersonalListeningSession: {
                        type: isConflict ? 'conflict' : 'accepted',
                        queue: snapshot,
                        conflict: isConflict ? {
                            reason: 'stale-revision',
                            queue: snapshot
                        } : null,
                        items: sessionItems(musicIds),
                        generatedAt: '2026-07-21T00:00:00.000Z'
                    }
                }
            })
        });
    });

    return { get requestCount() { return requestCount; } };
};

const openTrackActions = async (page: Page) => {
    await page.getByRole('button', {
        name: 'Open actions for Reconnect Track One'
    }).click();
    await expect(page.getByRole('button', { name: 'Start a session' }))
        .toBeVisible();
};

test('starts an explainable session and keeps playback stable through conflict retry', async ({
    page
}) => {
    const sessionMutation = await mockSessionMutation(page);
    await page.goto('/library');

    await openTrackActions(page);
    await page.getByRole('button', { name: 'Start a session' }).click();
    await expect(page.getByText('Started a 2-track session')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause playback' })).toBeVisible();

    await page.getByRole('button', { name: 'Open queue' }).click();
    await expect(page).toHaveURL(/\/queue$/);
    await expect(page.getByRole('button', {
        name: /Reconnect Track One.*Session start/
    })).toBeVisible();
    await expect(page.getByRole('button', {
        name: /Reconnect Track Two.*Same album/
    })).toBeVisible();

    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page).toHaveURL(/\/library$/);
    const titleBeforeConflict = await page.title();

    await openTrackActions(page);
    await page.getByRole('button', { name: 'Start a session' }).click();
    const retrySession = page.getByRole('button', { name: 'Retry session' });
    await expect(retrySession.locator('[role="alert"]')).toContainText(
        'Current playback is unchanged. The newest queue has 2 tracks. Retry to use it.'
    );
    await expect(retrySession).toBeVisible();
    expect(await page.title()).toBe(titleBeforeConflict);

    await retrySession.click();
    await expect(page.getByText('Started a 2-track session')).toBeVisible();
    await expect.poll(() => sessionMutation.requestCount).toBe(3);
});
