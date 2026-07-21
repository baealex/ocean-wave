import axios from 'axios';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const socketState = vi.hoisted(() => ({
    id: 'client-1'
}));

vi.mock('~/socket/socket', () => ({
    getOriginClientId: () => socketState.id
}));

import {
    getMusicMetadataOperations,
    groupMusicAsAlternateFile,
    linkMusicRecordings,
    previewMusicMetadataUpdate,
    recordPlayback,
    recoverMusicMetadataOperation,
    retryMusicMetadataOperation,
    setPreferredMusicFile,
    setMusicHated,
    setMusicLiked,
    ungroupMusicFile,
    unlinkMusicRecording,
    updateMusicMetadata
} from './music';

interface GraphqlPayload {
    query: string;
    variables?: Record<string, unknown>;
}

describe('music API requests', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sets liked state through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    setMusicLiked: {
                        id: '7',
                        isLiked: true
                    }
                }
            }
        });

        await setMusicLiked({ id: '7', isLiked: true });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            id: '7',
            isLiked: true,
            originClientId: 'client-1'
        });
        expect(payload.query).toContain('setMusicLiked(id: $id, isLiked: $isLiked, originClientId: $originClientId)');
        expect(payload.query).not.toContain('id: "7"');
    });

    it('sets hated state through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    setMusicHated: {
                        id: '7',
                        isHated: true
                    }
                }
            }
        });

        await setMusicHated({ id: '7', isHated: true });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            id: '7',
            isHated: true,
            originClientId: 'client-1'
        });
        expect(payload.query).toContain('setMusicHated(id: $id, isHated: $isHated, originClientId: $originClientId)');
    });

    it('records playback through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    recordPlayback: {
                        id: '7',
                        playCount: 1,
                        lastPlayedAt: '2026-04-10T10:00:15.000Z',
                        totalPlayedMs: 35_000,
                        skipCount: 0,
                        lastSkippedAt: null,
                        completionCount: 1,
                        lastCompletedAt: '2026-04-10T10:00:15.000Z',
                        countedAsPlay: true,
                        completionRate: 1,
                        outcome: 'complete',
                        deduped: false
                    }
                }
            }
        });

        await recordPlayback({
            id: '7',
            playedMs: 35_000,
            completionRate: 0.5,
            startedAt: '2026-04-10T10:00:00.000Z',
            endedAt: '2026-04-10T10:00:35.000Z',
            endReason: 'ended',
            hadSeek: false,
            source: 'queue-track-change',
            clientSessionId: 'session-1',
            branchId: 'target-branch-1',
            parentBranchId: 'session-1',
            branchBasePlayedMs: 20_000
        });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            input: {
                id: '7',
                playedMs: 35_000,
                completionRate: 0.5,
                startedAt: '2026-04-10T10:00:00.000Z',
                endedAt: '2026-04-10T10:00:35.000Z',
                endReason: 'ended',
                hadSeek: false,
                source: 'queue-track-change',
                clientSessionId: 'session-1',
                branchId: 'target-branch-1',
                parentBranchId: 'session-1',
                branchBasePlayedMs: 20_000
            },
            originClientId: 'client-1'
        });
        expect(payload.query).toContain('recordPlayback(input: $input, originClientId: $originClientId)');
        expect(payload.query).not.toContain('session-1');
    });

    it('updates track metadata through a GraphQL input variable', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    updateMusicMetadata: {
                        id: '7',
                        name: 'Edited Track'
                    }
                }
            }
        });
        const input = {
            id: '7',
            title: 'Edited Track',
            artist: 'Edited Artist',
            album: 'Edited Album',
            albumArtist: 'Album Artist',
            publishedYear: '2026',
            trackNumber: 3,
            genres: ['Ambient', 'Electronic']
        };

        await updateMusicMetadata(input, 'preview-token');

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            input,
            previewToken: 'preview-token',
            originClientId: 'client-1'
        });
        expect(payload.query).toContain(
            'updateMusicMetadata(input: $input, previewToken: $previewToken, originClientId: $originClientId)'
        );
        expect(payload.query).not.toContain('Edited Track');
    });

    it('previews and lists metadata operations through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    previewMusicMetadataUpdate: { token: 'preview-token' },
                    musicMetadataOperations: []
                }
            }
        });
        const input = {
            id: '7',
            title: 'Edited Track',
            album: 'Edited Album',
            publishedYear: '2026-07-21',
            trackNumber: null,
            genres: ['Ambient']
        };

        await previewMusicMetadataUpdate(input);
        await getMusicMetadataOperations('7');

        const payloads = post.mock.calls.map(call => call[1] as GraphqlPayload);

        expect(payloads[0]?.variables).toEqual({ input });
        expect(payloads[0]?.query).toContain('previewMusicMetadataUpdate(input: $input)');
        expect(payloads[0]?.query).not.toContain('Edited Track');
        expect(payloads[1]).toMatchObject({ variables: { musicId: '7' } });
        expect(payloads[1]?.query).toContain('musicMetadataOperations(musicId: $musicId)');
    });

    it('retries and recovers metadata operations through typed variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: { data: { operation: { operationId: 'operation-1' } } }
        });

        await retryMusicMetadataOperation('operation-1');
        await recoverMusicMetadataOperation('operation-2');

        const payloads = post.mock.calls.map(call => call[1] as GraphqlPayload);

        expect(payloads[0]).toMatchObject({
            variables: { operationId: 'operation-1', originClientId: 'client-1' }
        });
        expect(payloads[0]?.query).toContain(
            'retryMusicMetadataOperation(operationId: $operationId, originClientId: $originClientId)'
        );
        expect(payloads[1]).toMatchObject({
            variables: { operationId: 'operation-2', originClientId: 'client-1' }
        });
        expect(payloads[1]?.query).toContain(
            'recoverMusicMetadataOperation(operationId: $operationId, originClientId: $originClientId)'
        );
    });

    it('sends every recording and file grouping control through typed variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: { data: { music: { id: '7', name: 'Signal' } } }
        });

        await setPreferredMusicFile({ musicId: '7', fileId: '9' });
        await groupMusicAsAlternateFile({ musicId: '8', targetMusicId: '7' });
        await ungroupMusicFile({ musicId: '7', fileId: '9' });
        await linkMusicRecordings({ musicId: '8', targetMusicId: '7' });
        await unlinkMusicRecording({ musicId: '7' });

        const payloads = post.mock.calls.map(call => call[1] as GraphqlPayload);

        expect(payloads[0]).toMatchObject({
            variables: { musicId: '7', fileId: '9', originClientId: 'client-1' }
        });
        expect(payloads[0].query).toContain('setPreferredMusicFile');
        expect(payloads[1]).toMatchObject({
            variables: { musicId: '8', targetMusicId: '7', originClientId: 'client-1' }
        });
        expect(payloads[1].query).toContain('groupMusicAsAlternateFile');
        expect(payloads[2].query).toContain('ungroupMusicFile');
        expect(payloads[3].query).toContain('linkMusicRecordings');
        expect(payloads[4].query).toContain('unlinkMusicRecording');
    });
});
