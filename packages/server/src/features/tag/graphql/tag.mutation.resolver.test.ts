import models from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';
import { connectors } from '~/socket/connectors';
import { MUSIC_TAGS_UPDATED } from '~/socket/music';
import {
    TAG_CREATED,
    TAG_LIST_INVALIDATED,
    TAG_RENAMED
} from '~/socket/tag';

import {
    createAddTagToMusicMutationResolver,
    createCreateAndAddTagToMusicMutationResolver,
    createCreateTagMutationResolver,
    createDeleteTagMutationResolver,
    createRemoveTagFromMusicMutationResolver,
    createRenameTagMutationResolver
} from './tag.mutation.resolver';

const createMusic = async () => {
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
            syncStatus: TRACK_SYNC_STATUS.active
        }
    });
};

describe('tag mutation resolvers', () => {
    beforeEach(async () => {
        jest.restoreAllMocks();

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

    it('notifies tag creation with a namespaced event', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createCreateTagMutationResolver();

        const result = await resolver(null, {
            name: 'Focus',
            originClientId: 'client-1'
        });

        expect(result.name).toBe('Focus');
        expect(notifySpy).toHaveBeenCalledWith(TAG_CREATED, expect.objectContaining({
            id: result.id.toString(),
            name: 'Focus',
            normalizedName: 'focus',
            musicCount: 0,
            originClientId: 'client-1'
        }));
    });

    it('keeps mutation success when realtime notification fails', async () => {
        const error = new Error('notification failed');
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(connectors, 'notify').mockImplementation(() => {
            throw error;
        });
        const resolver = createCreateTagMutationResolver();

        await expect(resolver(null, { name: 'Focus' })).resolves.toEqual(expect.objectContaining({
            name: 'Focus',
            normalizedName: 'focus'
        }));
        expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    });

    it('notifies tag rename with a namespaced event', async () => {
        const tag = await models.tag.create({
            data: {
                name: 'Focus',
                normalizedName: 'focus'
            }
        });
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createRenameTagMutationResolver();

        const result = await resolver(null, {
            id: tag.id.toString(),
            name: 'Deep Focus'
        });

        expect(result.name).toBe('Deep Focus');
        expect(notifySpy).toHaveBeenCalledWith(TAG_RENAMED, expect.objectContaining({
            id: tag.id.toString(),
            name: 'Deep Focus',
            normalizedName: 'deep focus'
        }));
    });

    it('notifies music tag updates and tag list invalidation after adding a tag to music', async () => {
        const music = await createMusic();
        const tag = await models.tag.create({
            data: {
                name: 'Focus',
                normalizedName: 'focus'
            }
        });
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createAddTagToMusicMutationResolver();

        const result = await resolver(null, {
            musicId: music.id.toString(),
            tagId: tag.id.toString()
        });

        expect(result.id).toBe(music.id);
        expect(notifySpy).toHaveBeenCalledWith(MUSIC_TAGS_UPDATED, {
            musicId: music.id.toString(),
            tags: [expect.objectContaining({
                id: tag.id.toString(),
                name: 'Focus',
                musicCount: 1
            })]
        });
        expect(notifySpy).toHaveBeenCalledWith(TAG_LIST_INVALIDATED, {
            reason: 'music-tags-changed',
            affectedTagIds: [tag.id.toString()],
            affectedMusicIds: [music.id.toString()]
        });
    });

    it('notifies music tag updates and tag list invalidation after creating and adding a tag to music', async () => {
        const music = await createMusic();
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createCreateAndAddTagToMusicMutationResolver();

        const result = await resolver(null, {
            musicId: music.id.toString(),
            name: 'Focus'
        });

        expect(result.id).toBe(music.id);
        expect(notifySpy).toHaveBeenCalledWith(MUSIC_TAGS_UPDATED, {
            musicId: music.id.toString(),
            tags: [expect.objectContaining({
                name: 'Focus',
                normalizedName: 'focus',
                musicCount: 1
            })]
        });
        expect(notifySpy).toHaveBeenCalledWith(TAG_LIST_INVALIDATED, {
            reason: 'music-tags-changed',
            affectedMusicIds: [music.id.toString()]
        });
    });

    it('notifies music tag updates and tag list invalidation after removing a tag from music', async () => {
        const music = await createMusic();
        const tag = await models.tag.create({
            data: {
                name: 'Focus',
                normalizedName: 'focus'
            }
        });
        await models.musicTag.create({
            data: {
                musicId: music.id,
                tagId: tag.id
            }
        });
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createRemoveTagFromMusicMutationResolver();

        const result = await resolver(null, {
            musicId: music.id.toString(),
            tagId: tag.id.toString()
        });

        expect(result.id).toBe(music.id);
        expect(notifySpy).toHaveBeenCalledWith(MUSIC_TAGS_UPDATED, {
            musicId: music.id.toString(),
            tags: []
        });
        expect(notifySpy).toHaveBeenCalledWith(TAG_LIST_INVALIDATED, {
            reason: 'music-tags-changed',
            affectedTagIds: [tag.id.toString()],
            affectedMusicIds: [music.id.toString()]
        });
    });

    it('notifies tag list invalidation with affected ids after deleting a tag', async () => {
        const music = await createMusic();
        const tag = await models.tag.create({
            data: {
                name: 'Focus',
                normalizedName: 'focus'
            }
        });
        await models.musicTag.create({
            data: {
                musicId: music.id,
                tagId: tag.id
            }
        });
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createDeleteTagMutationResolver();

        const result = await resolver(null, { id: tag.id.toString() });

        expect(result).toEqual({
            id: tag.id.toString(),
            affectedMusicIds: [music.id.toString()],
            affectedSmartViewIds: []
        });
        expect(notifySpy).toHaveBeenCalledWith(TAG_LIST_INVALIDATED, {
            reason: 'tag-deleted',
            affectedTagIds: [tag.id.toString()],
            affectedMusicIds: [music.id.toString()],
            affectedSmartViewIds: []
        });
    });
});
