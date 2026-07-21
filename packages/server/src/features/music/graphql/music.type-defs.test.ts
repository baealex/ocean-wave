import schema from '~/schema';
import { LIBRARY_REDISCOVERY_REASON_CODES } from '../services/library-rediscovery-ranking';

describe('library rediscovery GraphQL contract', () => {
    it('keeps the query and reason codes aligned with the ranking service', () => {
        const query = schema.getQueryType()?.getFields().libraryRediscovery;
        const reasonType = schema.getType('LibraryRediscoveryReasonCode') as {
            getValues?: () => Array<{ name: string }>;
        } | undefined;

        expect(query?.type.toString()).toBe('LibraryRediscovery!');
        expect(reasonType?.getValues).toEqual(expect.any(Function));
        expect(reasonType?.getValues?.().map(value => value.name))
            .toEqual([...LIBRARY_REDISCOVERY_REASON_CODES]);
    });
});
