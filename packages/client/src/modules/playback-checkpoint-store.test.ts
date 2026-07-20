import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    clearPlaybackCheckpoints,
    clearPlaybackResumeCheckpoint,
    deletePlaybackCheckpoint,
    getPlaybackCheckpoint,
    listPlaybackCheckpoints,
    readPlaybackResumeCheckpoint,
    savePlaybackResumeCheckpoint,
    savePlaybackCheckpoint
} from './playback-checkpoint-store';
import type { PlaybackSessionCheckpoint } from './playback-session';

const createCheckpoint = (
    overrides: Partial<PlaybackSessionCheckpoint> = {}
): PlaybackSessionCheckpoint => ({
    clientSessionId: 'session-1',
    branchId: 'target-branch-1',
    parentBranchId: 'session-1',
    branchBasePlayedMs: 8_000,
    trackId: 'track-1',
    startedAt: '2026-04-10T10:00:00.000Z',
    accumulatedPlayedMs: 12_000,
    hadSeek: false,
    lastResumedAt: '2026-04-10T10:00:05.000Z',
    active: true,
    updatedAt: '2026-04-10T10:00:12.000Z',
    source: 'queue-checkpoint',
    ...overrides
});

describe('playback checkpoint store', () => {
    beforeEach(async () => {
        await clearPlaybackCheckpoints();
        const values = new Map<string, string>();
        vi.stubGlobal('sessionStorage', {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key)
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('saves and restores a checkpoint by client session id', async () => {
        const checkpoint = createCheckpoint();

        await savePlaybackCheckpoint(checkpoint);

        expect(await getPlaybackCheckpoint(checkpoint.clientSessionId)).toEqual(checkpoint);
    });

    it('overwrites an existing checkpoint with the latest snapshot', async () => {
        await savePlaybackCheckpoint(createCheckpoint());
        await savePlaybackCheckpoint(createCheckpoint({
            accumulatedPlayedMs: 24_000,
            active: false,
            updatedAt: '2026-04-10T10:00:24.000Z',
            source: 'queue-pause'
        }));

        expect(await getPlaybackCheckpoint('session-1')).toEqual(createCheckpoint({
            accumulatedPlayedMs: 24_000,
            active: false,
            updatedAt: '2026-04-10T10:00:24.000Z',
            source: 'queue-pause'
        }));
    });

    it('lists checkpoints in update order and removes deleted entries', async () => {
        const deletedCheckpoint = createCheckpoint({
            clientSessionId: 'session-1',
            updatedAt: '2026-04-10T10:00:10.000Z'
        });
        await savePlaybackCheckpoint(createCheckpoint({
            clientSessionId: 'session-2',
            updatedAt: '2026-04-10T10:00:20.000Z'
        }));
        await savePlaybackCheckpoint(deletedCheckpoint);

        expect(await listPlaybackCheckpoints()).toEqual([
            createCheckpoint({
                clientSessionId: 'session-1',
                updatedAt: '2026-04-10T10:00:10.000Z'
            }),
            createCheckpoint({
                clientSessionId: 'session-2',
                updatedAt: '2026-04-10T10:00:20.000Z'
            })
        ]);

        await deletePlaybackCheckpoint(deletedCheckpoint);

        expect(await getPlaybackCheckpoint('session-1')).toBeNull();
        expect(await listPlaybackCheckpoints()).toEqual([
            createCheckpoint({
                clientSessionId: 'session-2',
                updatedAt: '2026-04-10T10:00:20.000Z'
            })
        ]);
    });

    it('keeps sibling branches when one branch is delivered', async () => {
        const rootCheckpoint = createCheckpoint({
            clientSessionId: 'shared-session',
            branchId: 'shared-session',
            parentBranchId: null,
            branchBasePlayedMs: 0,
            accumulatedPlayedMs: 39_000,
            updatedAt: '2026-04-10T10:00:39.000Z'
        });
        const targetCheckpoint = createCheckpoint({
            clientSessionId: 'shared-session',
            branchId: 'target-branch',
            parentBranchId: 'shared-session',
            branchBasePlayedMs: 30_000,
            accumulatedPlayedMs: 50_000,
            updatedAt: '2026-04-10T10:00:50.000Z'
        });
        await savePlaybackCheckpoint(rootCheckpoint);
        await savePlaybackCheckpoint(targetCheckpoint);

        await deletePlaybackCheckpoint(rootCheckpoint);

        expect(await getPlaybackCheckpoint(
            'shared-session',
            'shared-session'
        )).toBeNull();
        expect(await getPlaybackCheckpoint(
            'shared-session',
            'target-branch'
        )).toEqual(targetCheckpoint);
    });

    it('keeps a newer checkpoint when an older delivery finishes late', async () => {
        const deliveredCheckpoint = createCheckpoint({
            accumulatedPlayedMs: 12_000,
            updatedAt: '2026-04-10T10:00:12.000Z'
        });
        const newerCheckpoint = createCheckpoint({
            accumulatedPlayedMs: 24_000,
            updatedAt: '2026-04-10T10:00:24.000Z',
            source: 'queue-periodic'
        });
        await savePlaybackCheckpoint(deliveredCheckpoint);
        await savePlaybackCheckpoint(newerCheckpoint);

        await deletePlaybackCheckpoint(deliveredCheckpoint);

        expect(await getPlaybackCheckpoint(
            newerCheckpoint.clientSessionId,
            newerCheckpoint.branchId
        )).toEqual(newerCheckpoint);
    });

    it('keeps a reload-safe resume lineage and clears only the matching session', () => {
        const checkpoint = createCheckpoint({ hadSeek: true });

        savePlaybackResumeCheckpoint(checkpoint);

        expect(readPlaybackResumeCheckpoint()).toEqual(checkpoint);

        clearPlaybackResumeCheckpoint('another-session');
        expect(readPlaybackResumeCheckpoint()).toEqual(checkpoint);

        clearPlaybackResumeCheckpoint(checkpoint.clientSessionId);
        expect(readPlaybackResumeCheckpoint()).toBeNull();
    });
});
