import axios from 'axios';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

vi.mock('~/socket/socket', () => ({
    getOriginClientId: () => 'client-1'
}));

import { createPersonalListeningSession } from './personal-listening-session';

describe('personal listening session API', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sends session choices and the queue revision through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: { data: { createPersonalListeningSession: {} } }
        });
        const input = {
            startMusicId: '42',
            length: 'standard' as const,
            scope: 'explore' as const,
            expectedRevision: 3,
            expectedPlaybackSessionRevision: 7,
            requestingEndpointId: 'local-tab',
            registrationGeneration: 2,
            registrationProof: 'proof-local-tab'
        };

        await createPersonalListeningSession(input, 5_000);

        const payload = post.mock.calls[0]?.[1] as {
            operationName: string;
            query: string;
            variables: Record<string, unknown>;
        };

        expect(payload.operationName).toBe('CreatePersonalListeningSession');
        expect(payload.variables).toEqual({
            input,
            originClientId: 'client-1'
        });
        expect(payload.query).toContain('input: $input');
        expect(payload.query).toContain('originClientId: $originClientId');
        expect(payload.query).not.toContain('42');
        expect(post.mock.calls[0]?.[2]).toEqual({ timeout: 5_000 });
    });
});
