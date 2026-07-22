import { parseByteRange, resolveStreamProfile, transcodeCacheKey, TranscodePool } from './audio-streaming';
describe('audio streaming policy', () => {
    it('validates normal, suffix, and unsatisfied ranges', () => {
        expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
        expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
        expect(parseByteRange('bytes=100-101', 100)).toBeUndefined();
    });
    it('uses direct play for original and supported high-quality codecs', () => {
        expect(resolveStreamProfile({ profile: 'original', sourceCodec: 'flac', supportedCodecs: [] }).direct).toBe(true);
        expect(resolveStreamProfile({ profile: 'high', sourceCodec: 'mp3', supportedCodecs: ['mp3'] }).direct).toBe(true);
        expect(resolveStreamProfile({ profile: 'data-saver', sourceCodec: 'mp3', supportedCodecs: ['mp3'] })).toMatchObject({ direct: false, bitrate: '64k' });
    });
    it('limits concurrent transcoding and recovers capacity', () => {
        const pool = new TranscodePool(1);
        expect(pool.acquire()).toBe(true); expect(pool.acquire()).toBe(false); pool.release(); expect(pool.acquire()).toBe(true);
    });
    it('creates profile-specific safe cache keys', () => expect(transcodeCacheKey({ stableId: '../track', updatedAtMs: 10, profile: 'data-saver' })).toBe('.._track-10-data-saver'));
});
