import {
    extractTitleVersionLabel,
    normalizeCandidateTitle,
    OCEAN_WAVE_RECORDING_VERSION_PROPERTY,
    OCEAN_WAVE_RECORDING_VERSION_STATE_PROPERTY,
    OCEAN_WAVE_RELEASE_VERSION_PROPERTY,
    OCEAN_WAVE_RELEASE_VERSION_STATE_PROPERTY,
    parseTrackIdentifiers,
    parseTrackTagSnapshot,
    readPortableTrackVersionMetadata,
    resolveTrackVersionMetadata,
    serializeTrackTagSnapshot
} from './track-version';

describe('track version metadata', () => {
    it('separates intrinsic performances from release-specific mastering labels', () => {
        expect(resolveTrackVersionMetadata({
            title: 'Signal (Live at the Harbor)'
        })).toEqual({
            recordingVersionTitle: 'Live at the Harbor',
            releaseVersionTitle: null
        });
        expect(resolveTrackVersionMetadata({
            title: 'Signal (2011 Remaster)'
        })).toEqual({
            recordingVersionTitle: null,
            releaseVersionTitle: '2011 Remaster'
        });
    });

    it('preserves explicit subtitles and uses them before title inference', () => {
        expect(resolveTrackVersionMetadata({
            title: 'Signal (2011 Remaster)',
            subtitles: ['Radio Edit']
        })).toEqual({
            recordingVersionTitle: 'Radio Edit',
            releaseVersionTitle: null
        });
        expect(extractTitleVersionLabel('Signal [Stereo]')).toMatchObject({
            baseTitle: 'Signal',
            label: 'Stereo',
            scope: 'releaseVersionTitle'
        });
        expect(resolveTrackVersionMetadata({
            title: 'Signal',
            subtitles: [['Live', '2026 Remaster'].join('\0')]
        })).toEqual({
            recordingVersionTitle: 'Live',
            releaseVersionTitle: '2026 Remaster'
        });
    });

    it('round-trips arbitrary recording and release version labels through portable tags', () => {
        expect(readPortableTrackVersionMetadata({
            RIFF: [
                {
                    id: `TXXX:${OCEAN_WAVE_RECORDING_VERSION_PROPERTY}`,
                    value: ' Studio Cut '
                },
                {
                    id: `TXXX:${OCEAN_WAVE_RELEASE_VERSION_PROPERTY}`,
                    value: 'Archive Edition'
                }
            ]
        })).toEqual({
            recordingVersionTitle: 'Studio Cut',
            releaseVersionTitle: 'Archive Edition',
            recordingVersionExplicit: true,
            releaseVersionExplicit: true
        });
    });

    it('distinguishes explicitly cleared version scopes from absent portable tags', () => {
        expect(readPortableTrackVersionMetadata({
            RIFF: [
                {
                    id: OCEAN_WAVE_RECORDING_VERSION_STATE_PROPERTY,
                    value: 'none'
                },
                {
                    id: OCEAN_WAVE_RELEASE_VERSION_PROPERTY,
                    value: 'Archive Edition'
                },
                {
                    id: OCEAN_WAVE_RELEASE_VERSION_STATE_PROPERTY,
                    value: 'value'
                }
            ]
        })).toEqual({
            recordingVersionTitle: null,
            releaseVersionTitle: 'Archive Edition',
            recordingVersionExplicit: true,
            releaseVersionExplicit: true
        });
        expect(readPortableTrackVersionMetadata(undefined)).toEqual({
            recordingVersionTitle: null,
            releaseVersionTitle: null,
            recordingVersionExplicit: false,
            releaseVersionExplicit: false
        });
    });

    it('normalizes recognized title suffixes only for conservative candidate matching', () => {
        expect(normalizeCandidateTitle('  Signal (2026 Remaster) ')).toBe('signal');
        expect(normalizeCandidateTitle('Signal (Part One)')).toBe('signal (part one)');
    });

    it('normalizes identifiers and round-trips the versioned diagnostic snapshot', () => {
        const identifiers = parseTrackIdentifiers({
            musicbrainz_recordingid: ' ABC-123 ',
            isrc: ['us-abc-12-34567', 'USABC1234567'],
            acoustid_id: ' Fingerprint-ID '
        });
        const snapshot = serializeTrackTagSnapshot({
            identifiers,
            recordingVersionTitle: 'Live',
            releaseVersionTitle: null
        });

        expect(identifiers).toEqual([
            { scheme: 'musicbrainz-recording', value: 'abc-123' },
            { scheme: 'isrc', value: 'USABC1234567' },
            { scheme: 'acoustid', value: 'fingerprint-id' }
        ]);
        expect(parseTrackTagSnapshot(snapshot)).toMatchObject({
            version: 1,
            identifiers,
            recordingVersionTitle: 'Live',
            releaseVersionTitle: null
        });
    });
});
