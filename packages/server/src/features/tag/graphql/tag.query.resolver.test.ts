import models from '~/models';
import {
    TRACK_SYNC_STATUS,
    type TrackSyncStatus
} from '~/modules/track-identity';

import { tagQueryResolvers } from './tag.query.resolver';

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

describe('tag query resolvers', () => {
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

    it('filters unused tags on the server before pagination', async () => {
        const unusedTag = await models.tag.create({
            data: {
                name: 'Unused',
                normalizedName: 'unused'
            }
        });
        const activeTag = await models.tag.create({
            data: {
                name: 'Active',
                normalizedName: 'active'
            }
        });
        const missingOnlyTag = await models.tag.create({
            data: {
                name: 'Missing Only',
                normalizedName: 'missing only'
            }
        });
        const smartViewTag = await models.tag.create({
            data: {
                name: 'Saved View',
                normalizedName: 'saved view'
            }
        });
        const activeMusic = await createMusic();
        const missingMusic = await createMusic(TRACK_SYNC_STATUS.missing);
        const smartView = await models.smartView.create({
            data: {
                name: 'Focus View',
                normalizedName: 'focus view'
            }
        });

        await models.musicTag.create({
            data: {
                musicId: activeMusic.id,
                tagId: activeTag.id
            }
        });
        await models.musicTag.create({
            data: {
                musicId: missingMusic.id,
                tagId: missingOnlyTag.id
            }
        });
        await models.smartViewTag.create({
            data: {
                smartViewId: smartView.id,
                tagId: smartViewTag.id
            }
        });

        const result = await (tagQueryResolvers as {
            allTags: (_: unknown, args: {
                searchFilter: {
                    query: string;
                    unusedOnly: boolean;
                };
                pagination: {
                    limit: number;
                    offset: number;
                };
            }) => Promise<{
                totalCount: number;
                tags: Array<{ id: number; name: string }>;
            }>;
        }).allTags(null, {
            searchFilter: {
                query: '',
                unusedOnly: true
            },
            pagination: {
                limit: 100,
                offset: 0
            }
        });

        expect(result.totalCount).toBe(2);
        expect(result.tags.map(tag => tag.id).sort()).toEqual([
            unusedTag.id,
            missingOnlyTag.id
        ].sort());
    });
});
