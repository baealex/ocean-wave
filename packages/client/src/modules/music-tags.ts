export type MusicTagFilterMode = 'all' | 'any';

interface MusicTagFilterTarget {
    tags: {
        id: string;
    }[];
}

const MUSIC_TAG_FILTER_MODES = new Set<MusicTagFilterMode>(['all', 'any']);

export const DEFAULT_MUSIC_TAG_FILTER_MODE: MusicTagFilterMode = 'all';
export const MUSIC_TAG_FILTER_PARAM = 'tags';
export const MUSIC_TAG_FILTER_MODE_PARAM = 'tagMode';

export const parseMusicTagIdsParam = (value: string | null | undefined) => {
    if (!value) {
        return [];
    }

    return [...new Set(value
        .split(',')
        .map(tagId => tagId.trim())
        .filter(tagId => /^\d+$/u.test(tagId)))];
};

export const resolveMusicTagFilterMode = (value: string | null | undefined): MusicTagFilterMode => {
    if (value && MUSIC_TAG_FILTER_MODES.has(value as MusicTagFilterMode)) {
        return value as MusicTagFilterMode;
    }

    return DEFAULT_MUSIC_TAG_FILTER_MODE;
};

export const filterMusicsByTagIds = <T extends MusicTagFilterTarget>(
    musics: T[],
    tagIds: string[],
    mode: MusicTagFilterMode = DEFAULT_MUSIC_TAG_FILTER_MODE
) => {
    if (!tagIds.length) {
        return musics;
    }

    const selectedTagIds = new Set(tagIds);

    return musics.filter((music) => {
        const musicTagIds = new Set(music.tags.map(tag => tag.id));

        if (mode === 'any') {
            return tagIds.some(tagId => musicTagIds.has(tagId));
        }

        return [...selectedTagIds].every(tagId => musicTagIds.has(tagId));
    });
};

export const getMusicTagFilterLabel = (selectedCount: number) => {
    if (selectedCount === 0) {
        return 'Tags';
    }

    return selectedCount === 1 ? '1 Tag' : `${selectedCount} Tags`;
};

export const createMusicTagFilterSearchParams = (
    tagIds: string[],
    mode: MusicTagFilterMode
) => {
    const searchParams = new URLSearchParams();

    if (tagIds.length > 0) {
        searchParams.set(MUSIC_TAG_FILTER_PARAM, tagIds.join(','));
    }

    if (tagIds.length > 0 && mode !== DEFAULT_MUSIC_TAG_FILTER_MODE) {
        searchParams.set(MUSIC_TAG_FILTER_MODE_PARAM, mode);
    }

    return searchParams;
};
