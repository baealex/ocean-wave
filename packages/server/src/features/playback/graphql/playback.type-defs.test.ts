import schema from '~/schema';
import { PERSONAL_LISTENING_SESSION_REASON_CODES } from '../services/personal-listening-session-ranking';

describe('personal listening session GraphQL contract', () => {
    it('keeps the mutation and reason codes aligned with the service', () => {
        const mutation = schema.getMutationType()?.getFields()
            .createPersonalListeningSession;
        const reasonType = schema.getType('PersonalListeningSessionReasonCode') as {
            getValues?: () => Array<{ name: string }>;
        } | undefined;
        const inputType = schema.getType('CreatePersonalListeningSessionInput') as {
            getFields?: () => Record<string, unknown>;
        } | undefined;

        expect(mutation?.type.toString()).toBe('PersonalListeningSessionResult!');
        expect(reasonType?.getValues).toEqual(expect.any(Function));
        expect(reasonType?.getValues?.().map(value => value.name))
            .toEqual([...PERSONAL_LISTENING_SESSION_REASON_CODES]);
        expect(Object.keys(inputType?.getFields?.() ?? {})).toEqual(expect.arrayContaining([
            'expectedPlaybackSessionRevision',
            'requestingEndpointId',
            'registrationGeneration',
            'registrationProof'
        ]));
    });
});
