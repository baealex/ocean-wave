import models from '~/models';

import {
    MusicMetadataServiceError,
    updateMusicMetadata
} from './metadata-editor';

const createMusic = async (suffix: string) => {
    const artist = await models.artist.create({ data: { name: `Original Artist ${suffix}` } });
    const album = await models.album.create({
        data: {
            name: `Original Album ${suffix}`,
            cover: '',
            publishedYear: '2025',
            artistId: artist.id
        }
    });

    return models.music.create({
        data: {
            name: `Original Track ${suffix}`,
            artistId: artist.id,
            albumId: album.id,
            filePath: `library/${suffix}.mp3`,
            duration: 180,
            codec: 'mp3',
            container: 'mp3',
            bitrate: 320_000,
            sampleRate: 44_100,
            trackNumber: 1
        }
    });
};

describe('music metadata editor', () => {
    it('updates library metadata and stores a scan-resistant override', async () => {
        const music = await createMusic('metadata-update');

        await updateMusicMetadata({
            id: music.id.toString(),
            title: 'Edited Track',
            artist: 'Edited Artist',
            album: 'Edited Album',
            albumArtist: 'Edited Album Artist',
            publishedYear: '2026',
            trackNumber: 4,
            genres: [' Ambient ', 'Electronic', 'Ambient']
        });

        const updated = await models.music.findUniqueOrThrow({
            where: { id: music.id },
            include: {
                Artist: true,
                Album: { include: { Artist: true } },
                Genre: true
            }
        });

        expect(updated).toMatchObject({
            name: 'Edited Track',
            trackNumber: 4,
            Artist: { name: 'Edited Artist' },
            Album: {
                name: 'Edited Album',
                publishedYear: '2026',
                Artist: { name: 'Edited Album Artist' }
            }
        });
        expect(updated.Genre.map((genre) => genre.name).sort()).toEqual(['Ambient', 'Electronic']);
        expect(JSON.parse(updated.metadataOverride ?? '')).toEqual({
            title: 'Edited Track',
            artist: 'Edited Artist',
            album: 'Edited Album',
            albumArtist: 'Edited Album Artist',
            year: '2026',
            trackNumber: 4,
            genres: ['Ambient', 'Electronic']
        });
    });

    it('rejects invalid track numbers before writing', async () => {
        const music = await createMusic('metadata-invalid');

        await expect(updateMusicMetadata({
            id: music.id.toString(),
            title: 'Edited Track',
            artist: 'Edited Artist',
            album: 'Edited Album',
            publishedYear: '2026',
            trackNumber: 0,
            genres: []
        })).rejects.toEqual(expect.objectContaining<Partial<MusicMetadataServiceError>>({
            code: 'INVALID_MUSIC_METADATA'
        }));
    });
});
