import { describe, expect, it } from 'vitest';

import {
    buildTagDeleteConfirmationMessage,
    createMusicTagFilterSearchParams,
    filterMusicsByTagIds,
    getMusicTagFilterLabel,
    getTagUsageSummary,
    isUnusedTag,
    parseMusicTagIdsParam,
    pruneUnavailableMusicTagIds,
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

    it('prunes deleted tag ids from draft filter state', () => {
        expect(pruneUnavailableMusicTagIds(['1', '2', '3'], ['1', '3'])).toEqual(['1', '3']);
    });

    it('summarizes tag usage across music and saved filters', () => {
        expect(getTagUsageSummary({
            musicCount: 2,
            smartViewCount: 1
        })).toBe('2 songs · 1 saved filter');
        expect(getTagUsageSummary({
            musicCount: 0,
            smartViewCount: 0
        })).toBe('Unused');
    });

    it('detects unused tags across music and saved filters', () => {
        expect(isUnusedTag({
            musicCount: 0,
            smartViewCount: 0
        })).toBe(true);
        expect(isUnusedTag({
            musicCount: 0,
            smartViewCount: 1
        })).toBe(false);
    });

    it('builds explicit delete confirmation copy', () => {
        expect(buildTagDeleteConfirmationMessage({
            musicCount: 3,
            smartViewCount: 2
        })).toContain('3 songs and 2 saved filters');
        expect(buildTagDeleteConfirmationMessage({
            musicCount: 0,
            smartViewCount: 0
        })).toContain('This tag is unused');
    });

    it('builds library search params for tag filters', () => {
        expect(createMusicTagFilterSearchParams(['2', '3'], 'all').toString()).toBe('tags=2%2C3');
        expect(createMusicTagFilterSearchParams(['2', '3'], 'any').toString()).toBe('tags=2%2C3&tagMode=any');
        expect(createMusicTagFilterSearchParams([], 'any').toString()).toBe('');
    });
});
