import {
    normalizeTagName,
    TAG_NAME_MAX_LENGTH
} from './normalization';

describe('tag normalization', () => {
    it('normalizes display and duplicate-check names without forcing display case', () => {
        expect(normalizeTagName('  Dreamy   Night  ')).toEqual({
            name: 'Dreamy Night',
            normalizedName: 'dreamy night'
        });
    });

    it('rejects empty and overlong tag names', () => {
        expect(normalizeTagName('   ')).toBeNull();
        expect(normalizeTagName('a'.repeat(TAG_NAME_MAX_LENGTH + 1))).toBeNull();
    });

    it('uses NFKC normalization before duplicate matching', () => {
        expect(normalizeTagName('Ｆｕｌｌｗｉｄｔｈ')?.normalizedName).toBe('fullwidth');
    });
});
