import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { Tag } from '~/models/type';

import { createTagNotificationHandlers } from './tag-notification-handler';

const createTag = (overrides?: Partial<Tag>): Tag => ({
    id: 'tag-1',
    scopeKey: 'music',
    name: 'Focus',
    normalizedName: 'focus',
    color: null,
    description: null,
    order: 0,
    musicCount: 1,
    smartViewCount: 0,
    createdAt: '2026-06-07T00:00:00.000Z',
    updatedAt: '2026-06-07T00:00:00.000Z',
    ...overrides
});

describe('createTagNotificationHandlers', () => {
    const invalidateQueries = vi.fn();
    const replaceTag = vi.fn();
    const removeTagFromMusics = vi.fn();

    beforeEach(() => {
        invalidateQueries.mockReset();
        replaceTag.mockReset();
        removeTagFromMusics.mockReset();
    });

    it('invalidates tag lists after tag creation notifications', () => {
        const handlers = createTagNotificationHandlers({
            queryClient: { invalidateQueries },
            musicStore: {
                replaceTag,
                removeTagFromMusics
            }
        });

        handlers.onCreated(createTag());

        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['tags'],
            exact: false
        });
        expect(replaceTag).not.toHaveBeenCalled();
        expect(removeTagFromMusics).not.toHaveBeenCalled();
    });

    it('updates loaded music tags and invalidates tag lists after rename notifications', () => {
        const tag = createTag({ name: 'Deep Focus' });
        const handlers = createTagNotificationHandlers({
            queryClient: { invalidateQueries },
            musicStore: {
                replaceTag,
                removeTagFromMusics
            }
        });

        handlers.onRenamed(tag);

        expect(replaceTag).toHaveBeenCalledWith(tag);
        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['tags'],
            exact: false
        });
    });

    it('removes deleted tags from affected loaded music and invalidates tag lists', () => {
        const handlers = createTagNotificationHandlers({
            queryClient: { invalidateQueries },
            musicStore: {
                replaceTag,
                removeTagFromMusics
            }
        });

        handlers.onListInvalidated({
            reason: 'tag-deleted',
            affectedTagIds: ['tag-1', 'tag-2'],
            affectedMusicIds: ['music-1', 'music-2']
        });

        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['tags'],
            exact: false
        });
        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['tag-views'],
            exact: false
        });
        expect(removeTagFromMusics).toHaveBeenCalledWith('tag-1', ['music-1', 'music-2']);
        expect(removeTagFromMusics).toHaveBeenCalledWith('tag-2', ['music-1', 'music-2']);
    });

    it('invalidates tag views after view change notifications', () => {
        const handlers = createTagNotificationHandlers({
            queryClient: { invalidateQueries },
            musicStore: {
                replaceTag,
                removeTagFromMusics
            }
        });

        handlers.onListInvalidated({
            reason: 'tag-views-changed',
            affectedSmartViewIds: ['view-1']
        });

        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['tags'],
            exact: false
        });
        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['tag-views'],
            exact: false
        });
        expect(removeTagFromMusics).not.toHaveBeenCalled();
    });
});
