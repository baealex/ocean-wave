import { describe, expect, it } from 'vitest';

import type { Music } from '~/models/type';

import {
    musicNeedsMetadataRepair,
    toMusicMetadataEditorValues,
    toUpdateMusicMetadataInput
} from './music-metadata-editor';

const credit = (name: string) => ({
    artist: { id: name, name },
    role: 'PRIMARY' as const,
    position: 0,
    creditedName: null,
    joinPhrase: ''
});

const music = {
    id: '7',
    name: 'Release title override',
    recordingTitle: 'Recording title',
    titleOverride: 'Release title override',
    recordingVersionTitle: 'Live',
    releaseVersionTitle: 'Deluxe',
    discNumber: 2,
    trackNumber: null,
    artist: { id: 'artist-1', name: 'Recording Artist' },
    artistCredits: [credit('Appearance Artist')],
    recordingArtistCredits: [credit('Recording Artist')],
    hasReleaseTrackArtistCredits: true,
    album: {
        id: 'release-1',
        name: 'Release',
        publishedYear: '2026-07-21',
        releaseType: 'LIVE',
        totalDiscs: 2,
        artist: { id: 'release-artist', name: 'Release Artist' },
        artistCredits: [credit('Release Artist')]
    },
    genres: [{ name: 'Ambient' }, { name: 'Electronic' }]
} as Music;

describe('music metadata editor values', () => {
    it('keeps recording, release, and appearance-owned values separate', () => {
        const values = toMusicMetadataEditorValues(music);

        expect(values).toMatchObject({
            recordingTitle: 'Recording title',
            titleOverride: 'Release title override',
            recordingVersionTitle: 'Live',
            useAppearanceCredits: true,
            releaseTitle: 'Release',
            releaseDate: '2026-07-21',
            releaseType: 'LIVE',
            totalDiscs: '2',
            releaseVersionTitle: 'Deluxe',
            discNumber: '2',
            trackNumber: '',
            genres: 'Ambient, Electronic'
        });
        expect(values.recordingArtistCredits[0]?.name).toBe('Recording Artist');
        expect(values.releaseTrackArtistCredits[0]?.name).toBe('Appearance Artist');
        expect(values.releaseArtistCredits[0]?.name).toBe('Release Artist');
    });

    it('sends nullable positions and clears the appearance credit override explicitly', () => {
        const values = {
            ...toMusicMetadataEditorValues(music),
            useAppearanceCredits: false,
            totalDiscs: '',
            discNumber: '',
            trackNumber: '',
            genres: ' Ambient, , Electronic '
        };

        expect(toUpdateMusicMetadataInput(music.id, values)).toMatchObject({
            id: '7',
            releaseTrackArtistCredits: null,
            totalDiscs: null,
            discNumber: null,
            trackNumber: null,
            genres: ['Ambient', 'Electronic']
        });
    });

    it('rejects an out-of-range optional position before preview', () => {
        const values = {
            ...toMusicMetadataEditorValues(music),
            discNumber: '0'
        };

        expect(() => toUpdateMusicMetadataInput(music.id, values)).toThrow(
            'Disc number must be between 1 and 9999, or left blank.'
        );
    });

    it('allows unchanged canonical values to repair a stale physical file', () => {
        expect(musicNeedsMetadataRepair({
            hasMetadataOverride: false,
            files: [{
                syncStatus: 'active',
                metadataSyncStatus: 'stale'
            } as NonNullable<Music['files']>[number]]
        })).toBe(true);
        expect(musicNeedsMetadataRepair({
            hasMetadataOverride: false,
            files: [{
                syncStatus: 'missing',
                metadataSyncStatus: 'stale'
            } as NonNullable<Music['files']>[number]]
        })).toBe(false);
    });
});
