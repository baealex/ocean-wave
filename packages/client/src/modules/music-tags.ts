export type MusicTagFilterMode = 'all' | 'any';

interface MusicTagFilterTarget {
    tags: {
        id: string;
    }[];
}

interface TagUsageTarget {
    musicCount: number;
    smartViewCount?: number;
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

export const pruneUnavailableMusicTagIds = (
    tagIds: string[],
    availableTagIds: Iterable<string>
) => {
    const availableTagIdSet = new Set(availableTagIds);

    return tagIds.filter(tagId => availableTagIdSet.has(tagId));
};

const getCountLabel = (count: number, singular: string, plural: string) => {
    return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
};

export const getTagUsageSummary = ({
    musicCount,
    smartViewCount = 0
}: Pick<TagUsageTarget, 'musicCount' | 'smartViewCount'>) => {
    const usages: string[] = [];

    if (musicCount > 0) {
        usages.push(getCountLabel(musicCount, 'song', 'songs'));
    }

    if (smartViewCount > 0) {
        usages.push(getCountLabel(smartViewCount, 'saved view', 'saved views'));
    }

    return usages.length > 0 ? usages.join(' · ') : 'Unused';
};

export const buildTagDeleteConfirmationMessage = ({
    musicCount,
    smartViewCount = 0
}: Pick<TagUsageTarget, 'musicCount' | 'smartViewCount'>) => {
    const affectedTargets: string[] = [];

    if (musicCount > 0) {
        affectedTargets.push(`${getCountLabel(musicCount, 'song', 'songs')}`);
    }

    if (smartViewCount > 0) {
        affectedTargets.push(`${getCountLabel(smartViewCount, 'saved view', 'saved views')}`);
    }

    if (affectedTargets.length === 0) {
        return 'This tag is unused. This cannot be undone.';
    }

    const messageLines = [
        `This will remove the tag from ${affectedTargets.join(' and ')}.`,
        'This cannot be undone.'
    ];

    if (smartViewCount > 0) {
        messageLines.splice(1, 0, 'Saved views using this tag may change their results.');
    }

    return messageLines.join(' ');
};

export const isUnusedTag = ({
    musicCount,
    smartViewCount = 0
}: Pick<TagUsageTarget, 'musicCount' | 'smartViewCount'>) => {
    return musicCount === 0 && smartViewCount === 0;
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
