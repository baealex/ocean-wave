import { describe, expect, it } from 'vitest';

import type { Album, Music } from '~/models/type';
import {
    filterAlbumsByRelease,
    getDiscLabel,
    groupTracksByDisc,
    resolveReleaseTypeFilter,
    shouldShowDiscHeadings
} from './releases';

const album = (
    id: string,
    releaseType: Album['releaseType'],
    name: string
) => ({
    id,
    releaseType,
    name,
    artistDisplayName: 'Artist'
}) as Album;

describe('release presentation', () => {
    it('filters by release type and lets type labels participate in search', () => {
        const albums = [
            album('1', 'ALBUM', 'First'),
            album('2', 'EP', 'Second'),
            album('3', 'LIVE', 'Third')
        ];

        expect(filterAlbumsByRelease({ albums, query: '', releaseType: 'EP' })
            .map(({ id }) => id)).toEqual(['2']);
        expect(filterAlbumsByRelease({ albums, query: 'live', releaseType: '' })
            .map(({ id }) => id)).toEqual(['3']);
        expect(resolveReleaseTypeFilter('BOOTLEG')).toBe('');
    });

    it('groups duplicate track numbers by ordered discs with unknown positions last', () => {
        const tracks = [
            { id: '4', discNumber: null, trackNumber: null },
            { id: '3', discNumber: 2, trackNumber: 1 },
            { id: '2', discNumber: 1, trackNumber: 2 },
            { id: '1', discNumber: 1, trackNumber: 1 }
        ] as Music[];
        const groups = groupTracksByDisc(tracks);

        expect(groups.map(group => ({
            discNumber: group.discNumber,
            ids: group.tracks.map(({ id }) => id)
        }))).toEqual([
            { discNumber: 1, ids: ['1', '2'] },
            { discNumber: 2, ids: ['3'] },
            { discNumber: null, ids: ['4'] }
        ]);
        expect(shouldShowDiscHeadings(groups, 2)).toBe(true);
        expect(getDiscLabel(null)).toBe('Unknown disc');
    });
});
