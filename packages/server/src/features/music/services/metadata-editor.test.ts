import fs from 'fs';
import os from 'os';
import path from 'path';

import models from '~/models';
import { albumResolvers } from '~/schema/album';
import { AudioMetadataWriteError } from '~/modules/audio-metadata-writer';
import { createTrackContentHash, TRACK_CONTENT_HASH_VERSION } from '~/modules/track-hash';
import { resolveMusicFilePath } from '~/modules/storage-paths';

import {
    MusicMetadataServiceError,
    updateMusicMetadata
} from './metadata-editor';
import { musicFieldResolvers } from '../graphql/music.field.resolver';

const createSilentWav = () => {
    const sampleRate = 8_000;
    const sampleCount = 800;
    const dataSize = sampleCount * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    return buffer;
};

const createMusic = async (suffix: string, fileData = createSilentWav()) => {
    const relativeFilePath = `library/${suffix}.wav`;
    const filePath = resolveMusicFilePath(relativeFilePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, fileData);
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
            filePath: relativeFilePath,
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
    const tempDirectories: string[] = [];
    const originalMusicPath = process.env.OCEAN_WAVE_MUSIC_PATH;

    beforeEach(() => {
        const musicPath = fs.mkdtempSync(path.join(os.tmpdir(), 'project441-metadata-library-'));
        tempDirectories.push(musicPath);
        process.env.OCEAN_WAVE_MUSIC_PATH = musicPath;
    });

    afterEach(() => {
        if (originalMusicPath === undefined) {
            delete process.env.OCEAN_WAVE_MUSIC_PATH;
        } else {
            process.env.OCEAN_WAVE_MUSIC_PATH = originalMusicPath;
        }

        while (tempDirectories.length > 0) {
            fs.rmSync(tempDirectories.pop()!, { recursive: true, force: true });
        }
    });

    it('writes metadata to the audio file and refreshes the library index', async () => {
        const music = await createMusic('metadata-update');
        const writeTrackMetadata = jest.fn(async (filePath: string) => {
            const writtenData = Buffer.concat([fs.readFileSync(filePath), Buffer.from('updated')]);
            fs.writeFileSync(filePath, writtenData);

            return {
                contentHash: createTrackContentHash(writtenData),
                hashVersion: TRACK_CONTENT_HASH_VERSION
            };
        });

        await updateMusicMetadata({
            id: music.id.toString(),
            title: 'Edited Track',
            artistCredits: [
                {
                    name: 'Edited Artist',
                    role: 'PRIMARY',
                    joinPhrase: ' feat. '
                },
                {
                    name: 'Guest Artist',
                    role: 'FEATURED',
                    joinPhrase: ''
                }
            ],
            album: 'Edited Album',
            albumArtistCredits: [{
                name: 'Various Artists',
                role: 'PRIMARY',
                joinPhrase: ''
            }],
            publishedYear: '2026',
            trackNumber: 4,
            genres: [' Ambient ', 'Electronic', 'Ambient']
        }, {
            writeTrackMetadata
        });

        const updated = await models.music.findUniqueOrThrow({
            where: { id: music.id },
            include: {
                Artist: true,
                Album: { include: { Artist: true } },
                Recording: {
                    include: {
                        RecordingGenre: { include: { Genre: true } },
                        ArtistCredit: {
                            include: { Artist: true },
                            orderBy: { position: 'asc' }
                        }
                    }
                }
            }
        });

        expect(updated).toMatchObject({
            name: 'Edited Track',
            trackNumber: 4,
            Artist: { name: 'Edited Artist' },
            Album: {
                name: 'Edited Album',
                publishedYear: '2026',
                Artist: { name: 'Various Artists' }
            }
        });
        expect(updated.Recording.ArtistCredit).toEqual([
            expect.objectContaining({
                role: 'primary',
                joinPhrase: ' feat. ',
                Artist: expect.objectContaining({ name: 'Edited Artist' })
            }),
            expect.objectContaining({
                role: 'featured',
                joinPhrase: '',
                Artist: expect.objectContaining({ name: 'Guest Artist' })
            })
        ]);
        await expect(models.artistCredit.findMany({
            where: { releaseId: updated.albumId },
            include: { Artist: true }
        })).resolves.toEqual([
            expect.objectContaining({
                role: 'primary',
                Artist: expect.objectContaining({ name: 'Various Artists' })
            })
        ]);
        const musicCreditResolvers = musicFieldResolvers as {
            artistDisplayName: (music: typeof updated) => Promise<string>;
            artistCredits: (music: typeof updated) => Promise<Array<{
                role: string;
                position: number;
                joinPhrase: string;
                artist: { name: string };
            }>>;
        };
        const albumCreditResolvers = albumResolvers.Album as {
            artistDisplayName: (album: typeof updated.Album) => Promise<string>;
        };

        await expect(musicCreditResolvers.artistDisplayName(updated))
            .resolves.toBe('Edited Artist feat. Guest Artist');
        await expect(musicCreditResolvers.artistCredits(updated)).resolves.toEqual([
            expect.objectContaining({
                role: 'PRIMARY',
                position: 0,
                joinPhrase: ' feat. ',
                artist: expect.objectContaining({ name: 'Edited Artist' })
            }),
            expect.objectContaining({
                role: 'FEATURED',
                position: 1,
                joinPhrase: '',
                artist: expect.objectContaining({ name: 'Guest Artist' })
            })
        ]);
        await expect(albumCreditResolvers.artistDisplayName(updated.Album))
            .resolves.toBe('Various Artists');
        expect(updated.Recording.RecordingGenre
            .map(({ Genre: genre }) => genre.name)
            .sort()).toEqual(['Ambient', 'Electronic']);
        expect(updated.metadataOverride).toBeNull();
        expect(updated.contentHash).not.toBeNull();
        expect(writeTrackMetadata).toHaveBeenCalledWith(
            resolveMusicFilePath(music.filePath),
            {
                title: 'Edited Track',
                artist: 'Edited Artist feat. Guest Artist',
                artistCredits: [
                    {
                        name: 'Edited Artist',
                        role: 'primary',
                        creditedName: null,
                        joinPhrase: ' feat. '
                    },
                    {
                        name: 'Guest Artist',
                        role: 'featured',
                        creditedName: null,
                        joinPhrase: ''
                    }
                ],
                album: 'Edited Album',
                albumArtist: 'Various Artists',
                albumArtistCredits: [{
                    name: 'Various Artists',
                    role: 'primary',
                    creditedName: null,
                    joinPhrase: ''
                }],
                year: '2026',
                trackNumber: 4,
                genres: ['Ambient', 'Electronic']
            }
        );

        expect(fs.readFileSync(resolveMusicFilePath(updated.filePath)))
            .not.toEqual(createSilentWav());
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

    it('preserves ordered credits when a legacy scalar client edits another field', async () => {
        const suffix = 'legacy-credit-preservation';
        const music = await createMusic(suffix);
        const guestArtist = await models.artist.create({
            data: { name: 'Legacy Guest Artist' }
        });
        const albumPartner = await models.artist.create({
            data: { name: 'Legacy Album Partner' }
        });

        await models.artistCredit.updateMany({
            where: { recordingId: music.recordingId, position: 0 },
            data: { joinPhrase: ' feat. ' }
        });
        await models.artistCredit.create({
            data: {
                recordingId: music.recordingId,
                artistId: guestArtist.id,
                role: 'featured',
                position: 1,
                creditedName: 'Guest Alias',
                joinPhrase: ''
            }
        });
        await models.artistCredit.updateMany({
            where: { releaseId: music.albumId, position: 0 },
            data: { joinPhrase: ' & ' }
        });
        await models.artistCredit.create({
            data: {
                releaseId: music.albumId,
                artistId: albumPartner.id,
                role: 'primary',
                position: 1,
                creditedName: 'Album Partner Alias',
                joinPhrase: ''
            }
        });
        const writeTrackMetadata = jest.fn(async () => ({
            contentHash: 'legacy-preserved-hash',
            hashVersion: TRACK_CONTENT_HASH_VERSION
        }));

        await updateMusicMetadata({
            id: music.id.toString(),
            title: 'Legacy Client Title Edit',
            artist: `Original Artist ${suffix}`,
            album: `Original Album ${suffix}`,
            albumArtist: `Original Artist ${suffix}`,
            publishedYear: '2025',
            trackNumber: 1,
            genres: []
        }, { writeTrackMetadata });

        await expect(models.artistCredit.findMany({
            where: { recordingId: music.recordingId },
            include: { Artist: true },
            orderBy: { position: 'asc' }
        })).resolves.toEqual([
            expect.objectContaining({
                role: 'primary',
                joinPhrase: ' feat. ',
                Artist: expect.objectContaining({ name: `Original Artist ${suffix}` })
            }),
            expect.objectContaining({
                role: 'featured',
                creditedName: 'Guest Alias',
                joinPhrase: '',
                Artist: expect.objectContaining({ name: 'Legacy Guest Artist' })
            })
        ]);
        await expect(models.artistCredit.findMany({
            where: { releaseId: music.albumId },
            include: { Artist: true },
            orderBy: { position: 'asc' }
        })).resolves.toEqual([
            expect.objectContaining({
                role: 'primary',
                joinPhrase: ' & ',
                Artist: expect.objectContaining({ name: `Original Artist ${suffix}` })
            }),
            expect.objectContaining({
                role: 'primary',
                creditedName: 'Album Partner Alias',
                joinPhrase: '',
                Artist: expect.objectContaining({ name: 'Legacy Album Partner' })
            })
        ]);
        expect(writeTrackMetadata).toHaveBeenCalledWith(
            resolveMusicFilePath(music.filePath),
            expect.objectContaining({
                artist: `Original Artist ${suffix} feat. Guest Alias`,
                albumArtist: `Original Artist ${suffix} & Album Partner Alias`,
                artistCredits: expect.arrayContaining([
                    expect.objectContaining({ name: 'Legacy Guest Artist', role: 'featured' })
                ]),
                albumArtistCredits: expect.arrayContaining([
                    expect.objectContaining({ name: 'Legacy Album Partner', role: 'primary' })
                ])
            })
        );
    });

    it('does not update the database when the audio file cannot be tagged', async () => {
        const music = await createMusic('metadata-write-failure', Buffer.from('invalid audio'));
        const writeTrackMetadata = jest.fn(async () => {
            throw new AudioMetadataWriteError(
                'The audio file metadata could not be updated.',
                'AUDIO_METADATA_WRITE_FAILED'
            );
        });

        await expect(updateMusicMetadata({
            id: music.id.toString(),
            title: 'Edited Track',
            artist: 'Edited Artist',
            album: 'Edited Album',
            publishedYear: '2026',
            trackNumber: 2,
            genres: ['Ambient']
        }, {
            writeTrackMetadata
        })).rejects.toEqual(expect.objectContaining<Partial<MusicMetadataServiceError>>({
            code: 'AUDIO_METADATA_WRITE_FAILED'
        }));

        await expect(models.music.findUniqueOrThrow({ where: { id: music.id } }))
            .resolves.toMatchObject({
                name: 'Original Track metadata-write-failure',
                metadataOverride: null
            });
    });

    it('serializes concurrent updates for the same audio file', async () => {
        const music = await createMusic('concurrent-metadata-update');
        let releaseFirstWrite!: () => void;
        let markFirstWriteStarted!: () => void;
        const firstWriteStarted = new Promise<void>((resolve) => {
            markFirstWriteStarted = resolve;
        });
        const firstWriteGate = new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
        });
        let activeWrites = 0;
        let maxActiveWrites = 0;
        const writeTrackMetadata = jest.fn(async (filePath: string, metadata: {
            title: string;
        }) => {
            activeWrites += 1;
            maxActiveWrites = Math.max(maxActiveWrites, activeWrites);

            if (metadata.title === 'First Edit') {
                markFirstWriteStarted();
                await firstWriteGate;
            }

            const writtenData = Buffer.concat([
                fs.readFileSync(filePath),
                Buffer.from(metadata.title)
            ]);
            fs.writeFileSync(filePath, writtenData);
            activeWrites -= 1;

            return {
                contentHash: createTrackContentHash(writtenData),
                hashVersion: TRACK_CONTENT_HASH_VERSION
            };
        });
        const createInput = (title: string) => ({
            id: music.id.toString(),
            title,
            artist: 'Edited Artist',
            album: 'Edited Album',
            publishedYear: '2026',
            trackNumber: 2,
            genres: ['Ambient']
        });

        const firstUpdate = updateMusicMetadata(createInput('First Edit'), {
            writeTrackMetadata
        });
        await firstWriteStarted;
        const secondUpdate = updateMusicMetadata(createInput('Second Edit'), {
            writeTrackMetadata
        });
        await Promise.resolve();

        expect(writeTrackMetadata).toHaveBeenCalledTimes(1);
        releaseFirstWrite();
        await Promise.all([firstUpdate, secondUpdate]);

        expect(maxActiveWrites).toBe(1);
        await expect(models.music.findUniqueOrThrow({ where: { id: music.id } }))
            .resolves.toMatchObject({ name: 'Second Edit' });
    });
});
