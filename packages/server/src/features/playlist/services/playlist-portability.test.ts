import {
    createImportReport,
    exportPlaylist,
    parseM3u,
    parseOceanWaveJson,
    parseXspf,
    PlaylistPortabilityError
} from './playlist-portability';

const playlist = {
    version: 1,
    name: 'Duplicates',
    tracks: [
        { stableId: 'stable-1', path: 'Music/a.mp3', title: 'A', artist: 'Artist', durationMs: 10_000 },
        { stableId: 'stable-1', path: 'Music/a.mp3', title: 'A', artist: 'Artist', durationMs: 10_000 }
    ]
};

describe('playlist portability', () => {
    it('round-trips Ocean Wave JSON without losing order or duplicates', () => {
        expect(parseOceanWaveJson(exportPlaylist(playlist, 'json'))).toEqual(playlist);
    });

    it('parses M3U metadata in source order and rejects external URLs as path hints', () => {
        expect(parseM3u('#EXTM3U\n#EXTINF:10,Artist - A\nMusic/a.mp3\n#EXTINF:20,B\nhttps://example.com/b.mp3').tracks).toEqual([
            { artist: 'Artist', title: 'A', durationMs: 10_000, path: 'Music/a.mp3' },
            { title: 'B', durationMs: 20_000 }
        ]);
    });

    it('parses XSPF identifiers and rejects XML entities', () => {
        const result = parseXspf(exportPlaylist(playlist, 'xspf'));
        expect(result.tracks.map(track => track.stableId)).toEqual(['stable-1', 'stable-1']);
        expect(() => parseXspf('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]>')).toThrow(PlaylistPortabilityError);
    });

    it('does not auto-select ambiguous candidates and accepts manual mappings', () => {
        const library = [
            { id: 1, title: 'A', artist: 'Artist', durationMs: 10_000 },
            { id: 2, title: 'A', artist: 'Artist', durationMs: 10_500 }
        ];
        expect(createImportReport(playlist, library)[0].status).toBe('ambiguous');
        expect(createImportReport(playlist, library, { 0: 2 })[0]).toMatchObject({ status: 'matched', selectedId: 2, reason: 'manual' });
    });

    it('rejects future JSON versions instead of silently dropping data', () => {
        expect(() => parseOceanWaveJson('{"version":2,"name":"Future","tracks":[]}')).toThrow('not supported');
    });
});
