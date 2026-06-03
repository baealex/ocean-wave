import models from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

import {
    createAndAddMusicTagToMusic,
    createMusicTag,
    deleteMusicTag,
    TAG_ERROR_CODE,
    TagServiceError
} from './music-tags';

const createMusic = async (overrides?: { syncStatus?: string }) => {
    const unique = Date.now().toString() + Math.random().toString(16).slice(2);
    const artist = await models.artist.create({ data: { name: `Artist ${unique}` } });
    const album = await models.album.create({
        data: {
            name: `Album ${unique}`,
            cover: `/covers/${unique}.jpg`,
            publishedYear: '2026',
            artistId: artist.id
        }
    });

    return models.music.create({
        data: {
            name: `Track ${unique}`,
            artistId: artist.id,
            albumId: album.id,
            filePath: `/music/${unique}.mp3`,
            duration: 200,
            codec: 'mp3',
            container: 'mp3',
            bitrate: 320,
            sampleRate: 44100,
            trackNumber: 1,
            syncStatus: overrides?.syncStatus ?? TRACK_SYNC_STATUS.active
        }
    });
};

describe('music tag service', () => {
    beforeEach(async () => {
        await models.smartViewTag.deleteMany();
        await models.smartView.deleteMany();
        await models.musicTag.deleteMany();
        await models.tag.deleteMany();
        await models.playbackEvent.deleteMany();
        await models.musicLike.deleteMany();
        await models.musicHate.deleteMany();
        await models.playlistMusic.deleteMany();
        await models.music.deleteMany();
        await models.album.deleteMany();
        await models.artist.deleteMany();
    });

    it('normalizes tag names and prevents duplicate tag records', async () => {
        const first = await createMusicTag({ name: '  Dreamy   Night  ' });
        const duplicate = createMusicTag({ name: 'dreamy night' });
        const tags = await models.tag.findMany();

        expect(first).toEqual(expect.objectContaining({
            name: 'Dreamy Night',
            normalizedName: 'dreamy night'
        }));
        await expect(duplicate).rejects.toMatchObject({
            code: TAG_ERROR_CODE.tagNameConflict
        });
        expect(tags).toHaveLength(1);
    });

    it('creates a tag and connects it to active music idempotently', async () => {
        const music = await createMusic();

        const first = await createAndAddMusicTagToMusic({
            musicId: music.id.toString(),
            name: 'Bath'
        });
        const second = await createAndAddMusicTagToMusic({
            musicId: music.id.toString(),
            name: ' bath '
        });

        expect(first.id).toBe(music.id);
        expect(second.id).toBe(music.id);
        await expect(models.tag.count()).resolves.toBe(1);
        await expect(models.musicTag.count()).resolves.toBe(1);
    });

    it('rejects adding tags to missing music', async () => {
        const music = await createMusic({ syncStatus: TRACK_SYNC_STATUS.missing });

        await expect(createAndAddMusicTagToMusic({
            musicId: music.id.toString(),
            name: 'Unavailable'
        })).rejects.toBeInstanceOf(TagServiceError);
        await expect(createAndAddMusicTagToMusic({
            musicId: music.id.toString(),
            name: 'Unavailable'
        })).rejects.toMatchObject({
            code: TAG_ERROR_CODE.musicNotFound
        });
        await expect(models.tag.count()).resolves.toBe(0);
        await expect(models.musicTag.count()).resolves.toBe(0);
    });

    it('deletes tag relations and returns affected ids', async () => {
        const music = await createMusic();
        const tag = await models.tag.create({
            data: {
                name: 'Focus',
                normalizedName: 'focus'
            }
        });
        const smartView = await models.smartView.create({
            data: {
                name: 'Focus View',
                normalizedName: 'focus view'
            }
        });

        await models.musicTag.create({
            data: {
                musicId: music.id,
                tagId: tag.id
            }
        });
        await models.smartViewTag.create({
            data: {
                smartViewId: smartView.id,
                tagId: tag.id
            }
        });

        await expect(deleteMusicTag({ id: tag.id.toString() })).resolves.toEqual({
            id: tag.id.toString(),
            affectedMusicIds: [music.id.toString()],
            affectedSmartViewIds: [smartView.id.toString()]
        });
        await expect(models.musicTag.count()).resolves.toBe(0);
        await expect(models.smartViewTag.count()).resolves.toBe(0);
    });
});
