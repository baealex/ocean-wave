import type {
    PersonalListeningSessionItem,
    PersonalListeningSessionLength,
    PersonalListeningSessionReasonCode,
    PersonalListeningSessionScope
} from '~/api/personal-listening-session';

export const DEFAULT_PERSONAL_LISTENING_SESSION_OPTIONS = {
    length: 'standard' as const,
    scope: 'explore' as const
};

export const PERSONAL_LISTENING_SESSION_COMMAND_PREFIX = (
    'personal-listening-session-'
);

export const PERSONAL_LISTENING_SESSION_LENGTH_OPTIONS: Array<{
    description: string;
    label: string;
    trackCount: number;
    value: PersonalListeningSessionLength;
}> = [
    {
        description: 'A quick listening break',
        label: 'Short',
        trackCount: 8,
        value: 'short'
    },
    {
        description: 'A balanced session',
        label: 'Standard',
        trackCount: 15,
        value: 'standard'
    },
    {
        description: 'A longer stretch',
        label: 'Long',
        trackCount: 25,
        value: 'long'
    }
];

export const PERSONAL_LISTENING_SESSION_SCOPE_OPTIONS: Array<{
    description: string;
    label: string;
    value: PersonalListeningSessionScope;
}> = [
    {
        description: 'Prefer stronger album, artist, tag, and View links.',
        label: 'Focused',
        value: 'focused'
    },
    {
        description: 'Include broader genre and tag links for more variety.',
        label: 'Explore',
        value: 'explore'
    }
];

const reasonCopy: Record<PersonalListeningSessionReasonCode, string> = {
    START_TRACK: 'Session start',
    SAME_ALBUM: 'Same album',
    SAME_ARTIST: 'Same artist',
    SHARED_SMART_VIEW: 'Matches the same View',
    SHARED_TAG: 'Shares a tag',
    SHARED_GENRE: 'Shares a genre'
};

const reasonPriority: PersonalListeningSessionReasonCode[] = [
    'START_TRACK',
    'SHARED_SMART_VIEW',
    'SHARED_TAG',
    'SHARED_GENRE',
    'SAME_ALBUM',
    'SAME_ARTIST'
];

export const getPersonalListeningSessionReasonLabel = (
    reasonCodes: PersonalListeningSessionReasonCode[]
) => {
    const reason = reasonPriority.find(code => reasonCodes.includes(code));
    return reason ? reasonCopy[reason] : null;
};

export const personalListeningSessionMatchesQueue = ({
    items,
    musicIds,
    queueRevision,
    revision
}: {
    items: PersonalListeningSessionItem[];
    musicIds: string[];
    queueRevision: number;
    revision: number | null;
}) => queueRevision === revision
    && items.length === musicIds.length
    && items.every((item, index) => item.musicId === musicIds[index]);
