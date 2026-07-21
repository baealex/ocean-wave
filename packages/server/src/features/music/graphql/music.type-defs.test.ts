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

describe('artist credit GraphQL contract', () => {
    it('exposes ordered credits while keeping scalar artists as deprecated compatibility fields', () => {
        const musicType = schema.getType('Music') as {
            getFields: () => Record<string, {
                deprecationReason?: string;
                type: { toString: () => string };
            }>;
        };
        const albumType = schema.getType('Album') as typeof musicType;
        const metadataInput = schema.getType('UpdateMusicMetadataInput') as {
            getFields: () => Record<string, { type: { toString: () => string } }>;
        };

        expect(musicType.getFields().artistCredits.type.toString()).toBe('[ArtistCredit!]!');
        expect(musicType.getFields().artistDisplayName.type.toString()).toBe('String!');
        expect(musicType.getFields().artist.deprecationReason).toContain('next breaking schema');
        expect(albumType.getFields().artistCredits.type.toString()).toBe('[ArtistCredit!]!');
        expect(albumType.getFields().artist.deprecationReason).toContain('next breaking schema');
        expect(metadataInput.getFields().artistCredits.type.toString()).toBe('[ArtistCreditInput!]');
        expect(metadataInput.getFields().albumArtistCredits.type.toString())
            .toBe('[ArtistCreditInput!]');
        expect(metadataInput.getFields().artist.type.toString()).toBe('String');
    });
});

describe('release structure GraphQL contract', () => {
    it('exposes safe release types, nullable positions, and Appears On', () => {
        const musicType = schema.getType('Music') as {
            getFields: () => Record<string, { type: { toString: () => string } }>;
        };
        const albumType = schema.getType('Album') as typeof musicType;
        const artistType = schema.getType('Artist') as typeof musicType;
        const releaseType = schema.getType('ReleaseType') as unknown as {
            getValues: () => Array<{ name: string }>;
        };

        expect(musicType.getFields().discNumber.type.toString()).toBe('Int');
        expect(musicType.getFields().trackNumber.type.toString()).toBe('Int');
        expect(albumType.getFields().releaseType.type.toString()).toBe('ReleaseType!');
        expect(albumType.getFields().totalDiscs.type.toString()).toBe('Int');
        expect(artistType.getFields().appearsOn.type.toString()).toBe('[Album!]!');
        expect(releaseType.getValues().map(value => value.name)).toEqual([
            'ALBUM',
            'EP',
            'SINGLE',
            'COMPILATION',
            'LIVE',
            'UNKNOWN'
        ]);
    });
});
