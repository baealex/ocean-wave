import {
    compareReleaseTrackPositions,
    normalizePositiveInteger,
    normalizeReleaseType,
    readPortableReleaseType,
    readPortableTotalDiscs,
    toGraphQLReleaseType
} from './release-metadata';

describe('release metadata', () => {
    it('normalizes supported release tags with deterministic secondary-type precedence', () => {
        expect(normalizeReleaseType({ values: ['Album', 'Live'] })).toBe('live');
        expect(normalizeReleaseType({ values: ['album', 'EP'] })).toBe('ep');
        expect(normalizeReleaseType({ values: 'Extended Play' })).toBe('ep');
        expect(normalizeReleaseType({ values: 'album', compilation: true }))
            .toBe('compilation');
        expect(normalizeReleaseType({ values: ['Bootleg', 'Demo'] })).toBe('unknown');
        expect(readPortableReleaseType({
            'ID3v2.4': [{ id: 'TXXX:OCEANWAVE_RELEASE_TYPE', value: 'ep' }]
        })).toBe('ep');
        expect(readPortableTotalDiscs({
            'ID3v2.4': [{ id: 'TXXX:DISCTOTAL', value: '3' }]
        })).toBe(3);
    });

    it('accepts only positive bounded integer positions', () => {
        expect(normalizePositiveInteger(2)).toBe(2);
        expect(normalizePositiveInteger('3')).toBe(3);
        expect(normalizePositiveInteger(null)).toBeNull();
        expect(normalizePositiveInteger(0)).toBeNull();
        expect(normalizePositiveInteger(1.5)).toBeNull();
        expect(normalizePositiveInteger('not-a-number')).toBeNull();
    });

    it('sorts discs and tracks with unknown positions last and ids as a stable tie-breaker', () => {
        const positions = [
            { id: 5, discNumber: null, trackNumber: 1 },
            { id: 4, discNumber: 2, trackNumber: 1 },
            { id: 3, discNumber: 1, trackNumber: null },
            { id: 2, discNumber: 1, trackNumber: 1 },
            { id: 1, discNumber: 1, trackNumber: 1 }
        ];

        expect(positions.sort(compareReleaseTrackPositions).map(({ id }) => id))
            .toEqual([1, 2, 3, 4, 5]);
    });

    it('maps invalid stored values to the safe GraphQL unknown enum', () => {
        expect(toGraphQLReleaseType('single')).toBe('SINGLE');
        expect(toGraphQLReleaseType('bootleg')).toBe('UNKNOWN');
    });
});
