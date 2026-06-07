import models, { type Tag } from '~/models';
import {
    TRACK_SYNC_STATUS,
    type TrackSyncStatus
} from '~/modules/track-identity';

import { tagFieldResolvers } from './tag.field.resolver';

const createMusic = async (syncStatus: TrackSyncStatus = TRACK_SYNC_STATUS.active) => {
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
            syncStatus
        }
    });
};

describe('tag field resolvers', () => {
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

    it('counts active music only', async () => {
        const tag = await models.tag.create({
            data: {
                name: 'Focus',
                normalizedName: 'focus'
            }
        });
        const activeMusic = await createMusic();
        const missingMusic = await createMusic(TRACK_SYNC_STATUS.missing);

        await models.musicTag.createMany({
            data: [{
                musicId: activeMusic.id,
                tagId: tag.id
            }, {
                musicId: missingMusic.id,
                tagId: tag.id
            }]
        });

        const musicCount = await (tagFieldResolvers as {
            musicCount: (tag: Tag) => Promise<number>;
        }).musicCount(tag);

        expect(musicCount).toBe(1);
    });

    it('counts smart views using the tag', async () => {
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

        await models.smartViewTag.create({
            data: {
                smartViewId: smartView.id,
                tagId: tag.id
            }
        });

        const smartViewCount = await (tagFieldResolvers as {
            smartViewCount: (tag: Tag) => Promise<number>;
        }).smartViewCount(tag);

        expect(smartViewCount).toBe(1);
    });
});
