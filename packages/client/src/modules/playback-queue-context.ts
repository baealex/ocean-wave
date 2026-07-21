import type { PlaybackQueueContext } from '~/api/playback-queue';

export const GENERAL_PLAYBACK_QUEUE_CONTEXT: PlaybackQueueContext = {
    type: 'queue',
    id: null,
    title: null
};

const isPositiveId = (value: unknown): value is string => (
    typeof value === 'string'
    && /^[1-9]\d*$/.test(value)
);

export const normalizePlaybackQueueContext = (
    context: unknown
): PlaybackQueueContext => {
    if (!context || typeof context !== 'object') {
        return GENERAL_PLAYBACK_QUEUE_CONTEXT;
    }

    const candidate = context as Record<string, unknown>;

    if (candidate.type === 'queue') {
        return GENERAL_PLAYBACK_QUEUE_CONTEXT;
    }

    if (
        (candidate.type === 'album' || candidate.type === 'playlist')
        && isPositiveId(candidate.id)
        && typeof candidate.title === 'string'
    ) {
        const title = candidate.title.trim();

        if (title && title.length <= 512) {
            return {
                type: candidate.type,
                id: candidate.id,
                title
            };
        }
    }

    return GENERAL_PLAYBACK_QUEUE_CONTEXT;
};
