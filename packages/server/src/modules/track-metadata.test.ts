import { parseBuffer } from './music-metadata';
import { parseTrackMetadata } from './track-metadata';

jest.mock('./music-metadata', () => ({ parseBuffer: jest.fn() }));

const parseBufferMock = jest.mocked(parseBuffer);

describe('track release metadata parsing', () => {
    beforeEach(() => {
        parseBufferMock.mockReset();
    });

    it('reads release type and multi-disc positions from common tags', async () => {
        parseBufferMock.mockResolvedValue({
            format: {},
            common: {
                title: 'Disc Two',
                artist: 'Artist',
                album: 'Live Set',
                year: 2026,
                track: { no: 1, of: 10 },
                disk: { no: 2, of: 3 },
                releasetype: ['Album', 'Live']
            }
        } as never);

        await expect(parseTrackMetadata('/music/disc-two.flac', Buffer.from('audio')))
            .resolves.toMatchObject({
                releaseType: 'live',
                discNumber: 2,
                totalDiscs: 3,
                trackNumber: 1
            });
    });

    it('keeps absent positions nullable and unknown types visible', async () => {
        parseBufferMock.mockResolvedValue({
            format: {},
            common: {
                artist: 'Artist',
                album: 'Unclassified',
                track: { no: null, of: null },
                disk: { no: null, of: null },
                releasetype: ['Bootleg']
            }
        } as never);

        await expect(parseTrackMetadata('/music/untitled.flac', Buffer.from('audio')))
            .resolves.toMatchObject({
                releaseType: 'unknown',
                discNumber: null,
                totalDiscs: null,
                trackNumber: null
            });
    });
});
