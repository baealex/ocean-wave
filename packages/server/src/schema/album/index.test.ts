import { albumResolvers } from './index';

describe('album cover resolver', () => {
    it('returns the canonical cover route from album id', () => {
        const updatedAt = new Date('2026-07-14T09:00:00.000Z');
        const cover = (albumResolvers.Album as { cover: (album: { id: number; cover: string; updatedAt: Date }) => string }).cover({
            id: 42,
            cover: '/cache/resized/999.jpg',
            updatedAt
        });

        expect(cover).toBe(`/cache/resized/42.jpg?v=${updatedAt.getTime()}`);
    });

    it('keeps empty cover values empty', () => {
        const cover = (albumResolvers.Album as { cover: (album: { id: number; cover: string; updatedAt: Date }) => string }).cover({
            id: 42,
            cover: '',
            updatedAt: new Date('2026-07-14T09:00:00.000Z')
        });

        expect(cover).toBe('');
    });
});
