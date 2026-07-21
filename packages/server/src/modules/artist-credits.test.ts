import {
    formatArtistCredits,
    normalizeArtistCredits,
    parseArtistCredits,
    preserveArtistCreditPresentation
} from './artist-credits';

describe('artist credits', () => {
    it('recovers featured roles and join phrases from multi-value tags', () => {
        const credits = parseArtistCredits({
            displayName: 'Artist A feat. Artist B',
            names: ['Artist A', 'Artist B']
        });

        expect(credits).toEqual([
            {
                name: 'Artist A',
                role: 'primary',
                creditedName: null,
                joinPhrase: ' feat. '
            },
            {
                name: 'Artist B',
                role: 'featured',
                creditedName: null,
                joinPhrase: ''
            }
        ]);
        expect(formatArtistCredits(credits)).toBe('Artist A feat. Artist B');
    });

    it('preserves ampersand collaboration formatting', () => {
        const credits = parseArtistCredits({
            displayName: 'Artist A & Artist B',
            names: ['Artist A', 'Artist B']
        });

        expect(credits.map(credit => credit.role)).toEqual(['primary', 'primary']);
        expect(formatArtistCredits(credits)).toBe('Artist A & Artist B');
    });

    it('does not split a singular artist tag on commas', () => {
        expect(parseArtistCredits({
            displayName: 'Earth, Wind & Fire'
        })).toEqual([{
            name: 'Earth, Wind & Fire',
            role: 'primary',
            creditedName: null,
            joinPhrase: ''
        }]);
    });

    it('keeps canonical presentation when a rescan returns the same participants', () => {
        const incoming = parseArtistCredits({
            displayName: 'Artist A; Artist B',
            names: ['Artist A', 'Artist B']
        });
        const preserved = preserveArtistCreditPresentation(incoming, [
            {
                id: 1,
                artistId: 1,
                recordingId: 1,
                releaseId: null,
                releaseTrackId: null,
                role: 'primary',
                position: 0,
                creditedName: null,
                joinPhrase: ' feat. ',
                createdAt: new Date(0),
                updatedAt: new Date(0),
                Artist: {
                    id: 1,
                    stableId: 'artist-a',
                    name: 'Artist A',
                    normalizedName: 'artist a',
                    createdAt: new Date(0),
                    updatedAt: new Date(0)
                }
            },
            {
                id: 2,
                artistId: 2,
                recordingId: 1,
                releaseId: null,
                releaseTrackId: null,
                role: 'featured',
                position: 1,
                creditedName: null,
                joinPhrase: '',
                createdAt: new Date(0),
                updatedAt: new Date(0),
                Artist: {
                    id: 2,
                    stableId: 'artist-b',
                    name: 'Artist B',
                    normalizedName: 'artist b',
                    createdAt: new Date(0),
                    updatedAt: new Date(0)
                }
            }
        ]);

        expect(formatArtistCredits(preserved)).toBe('Artist A feat. Artist B');
        expect(preserved[1].role).toBe('featured');
    });

    it('defaults an omitted separator without accepting a credit set with no primary artist', () => {
        expect(normalizeArtistCredits([
            { name: 'Artist A', role: 'PRIMARY' },
            { name: 'Artist B', role: 'FEATURED' }
        ])).toEqual([
            {
                name: 'Artist A',
                role: 'primary',
                creditedName: null,
                joinPhrase: ' & '
            },
            {
                name: 'Artist B',
                role: 'featured',
                creditedName: null,
                joinPhrase: ''
            }
        ]);

        expect(() => normalizeArtistCredits([
            { name: 'Artist B', role: 'FEATURED' }
        ])).toThrow('must include a primary artist');

        expect(normalizeArtistCredits([
            { name: 'Artist A', role: 'PRIMARY', joinPhrase: '' },
            { name: 'Artist B', role: 'PRIMARY', joinPhrase: '' }
        ])[0].joinPhrase).toBe('');
    });
});
