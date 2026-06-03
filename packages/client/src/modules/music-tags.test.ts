import { describe, expect, it } from 'vitest';

import {
    createMusicTagFilterSearchParams,
    filterMusicsByTagIds,
    getMusicTagFilterLabel,
    parseMusicTagIdsParam,
    resolveMusicTagFilterMode
} from './music-tags';

const createMusic = (id: string, tagIds: string[]) => ({
    id,
    tags: tagIds.map(tagId => ({ id: tagId }))
});

describe('music tag filters', () => {
    it('parses unique numeric tag ids from URL params', () => {
        expect(parseMusicTagIdsParam('2, 1,2,abc,,3')).toEqual(['2', '1', '3']);
    });

    it('resolves the supported filter mode', () => {
        expect(resolveMusicTagFilterMode('any')).toBe('any');
        expect(resolveMusicTagFilterMode('unknown')).toBe('all');
    });

    it('filters music by all selected tags by default', () => {
        expect(filterMusicsByTagIds([
            createMusic('1', ['1', '2']),
            createMusic('2', ['1']),
            createMusic('3', ['2'])
        ], ['1', '2']).map(music => music.id)).toEqual(['1']);
    });

    it('filters music by any selected tag when requested', () => {
        expect(filterMusicsByTagIds([
            createMusic('1', ['1', '2']),
            createMusic('2', ['3'])
        ], ['2', '3'], 'any').map(music => music.id)).toEqual(['1', '2']);
    });

    it('builds a compact filter label', () => {
        expect(getMusicTagFilterLabel(0)).toBe('Tags');
        expect(getMusicTagFilterLabel(1)).toBe('1 Tag');
        expect(getMusicTagFilterLabel(2)).toBe('2 Tags');
    });

    it('builds library search params for tag filters', () => {
        expect(createMusicTagFilterSearchParams(['2', '3'], 'all').toString()).toBe('tags=2%2C3');
        expect(createMusicTagFilterSearchParams(['2', '3'], 'any').toString()).toBe('tags=2%2C3&tagMode=any');
        expect(createMusicTagFilterSearchParams([], 'any').toString()).toBe('');
    });
});
