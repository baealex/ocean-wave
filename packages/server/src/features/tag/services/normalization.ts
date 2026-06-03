export const TAG_SCOPE_KEY = 'local';
export const TAG_SOURCE_MANUAL = 'manual';
export const TAG_NAME_MAX_LENGTH = 64;

export interface NormalizedTagName {
    name: string;
    normalizedName: string;
}

const collapseWhitespace = (value: string) => value.replace(/\s+/gu, ' ').trim();

export const normalizeTagName = (value: string): NormalizedTagName | null => {
    const name = collapseWhitespace(value.normalize('NFKC'));

    if (!name || Array.from(name).length > TAG_NAME_MAX_LENGTH) {
        return null;
    }

    return {
        name,
        normalizedName: collapseWhitespace(name.toLowerCase())
    };
};
