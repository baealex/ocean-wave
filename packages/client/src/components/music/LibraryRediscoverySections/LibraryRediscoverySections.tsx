import classNames from 'classnames';

import {
    CollectionCard,
    Image,
    SectionHeader
} from '~/components/shared';
import * as Icon from '~/icon';
import type {
    LibraryRediscoveryAlbumItem,
    LibraryRediscoverySection,
    LibraryRediscoveryTrackItem
} from '~/modules/library-rediscovery-sections';
import {
    REMOTE_PLAYBACK_OWNERSHIP_MESSAGE,
    REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
} from '~/modules/playback-ownership';

const cx = classNames;

interface LibraryRediscoverySectionsProps {
    playbackBlocked?: boolean;
    sections: LibraryRediscoverySection[];
    onPlayTrack: (musicId: string) => void;
}

const artworkClassName = [
    'relative block aspect-square w-full overflow-hidden rounded-[var(--b-radius-lg)]',
    'bg-[var(--b-color-surface-item)] shadow-[var(--b-shadow-artwork-placeholder)]',
    'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit]',
    'after:shadow-[var(--b-shadow-inset-artwork-ring)] after:content-[\'\']'
].join(' ');

const trackCardClassName = [
    'group/card ow-active-press flex h-full min-w-0 flex-col rounded-[var(--b-radius-xl)]',
    'border border-transparent p-2 text-left text-[var(--b-color-text)]',
    'transition-[background-color,border-color,transform,opacity] duration-150',
    'hover:border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-surface-subtle)]',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
    'disabled:cursor-not-allowed disabled:opacity-40'
].join(' ');

const Reason = ({ item }: {
    item: LibraryRediscoveryAlbumItem | LibraryRediscoveryTrackItem;
}) => (
    <span data-reason-code={item.reason.code}>
        {item.reason.copy}
    </span>
);

const TrackCard = ({
    item,
    playbackBlocked,
    onPlayTrack
}: {
    item: LibraryRediscoveryTrackItem;
    playbackBlocked: boolean;
    onPlayTrack: (musicId: string) => void;
}) => (
    <button
        type="button"
        className={trackCardClassName}
        disabled={playbackBlocked}
        title={playbackBlocked ? REMOTE_PLAYBACK_OWNERSHIP_MESSAGE : undefined}
        aria-describedby={playbackBlocked ? REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID : undefined}
        aria-label={playbackBlocked
            ? `Play ${item.music.name} by ${item.music.artistDisplayName} unavailable while another device owns playback. Why this appears: ${item.reason.copy}`
            : `Play ${item.music.name} by ${item.music.artistDisplayName}. Why this appears: ${item.reason.copy}`}
        onClick={() => onPlayTrack(item.music.id)}>
        <span className="relative aspect-square w-full shrink-0 transition-transform duration-150 group-hover/card:scale-[1.015] motion-reduce:transition-none">
            <span className={artworkClassName}>
                <Image
                    src={item.music.album.cover}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                />
                <span
                    aria-hidden="true"
                    className="absolute bottom-2.5 right-2.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--b-color-point)] text-white shadow-[var(--b-shadow-queue-artwork)] [&_svg]:h-4 [&_svg]:w-4">
                    <Icon.Play />
                </span>
            </span>
        </span>
        <span className="flex min-h-[88px] min-w-0 flex-1 flex-col gap-1 px-1 pt-3">
            <span className="line-clamp-2 text-sm font-semibold leading-[1.35]">
                {item.music.name}
            </span>
            <span className="truncate text-xs text-[var(--b-color-text-secondary)]">
                {item.music.artistDisplayName}
            </span>
            <span className="mt-auto line-clamp-2 text-xs text-[var(--b-color-text-tertiary)]">
                <Reason item={item} />
            </span>
        </span>
    </button>
);

const AlbumCard = ({ item }: { item: LibraryRediscoveryAlbumItem }) => (
    <CollectionCard
        to={`/album/${item.album.id}`}
        title={item.album.name}
        description={item.artistName}
        meta={(
            <span data-reason-code={item.reason.code}>
                {item.reason.copy} · {item.trackCount} {item.trackCount === 1 ? 'track' : 'tracks'}
            </span>
        )}
        artwork={(
            <span className={artworkClassName}>
                <Image
                    src={item.album.cover}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                />
            </span>
        )}
    />
);

const LibraryRediscoverySections = ({
    playbackBlocked = false,
    sections,
    onPlayTrack
}: LibraryRediscoverySectionsProps) => {
    if (sections.length === 0) {
        return null;
    }

    return (
        <div
            className="mx-[var(--b-spacing-lg)] mb-[var(--b-spacing-xl)] flex flex-col gap-8"
            aria-label="Library rediscovery">
            {sections.map(section => (
                <section
                    key={section.id}
                    data-rediscovery-section={section.id}
                    className="flex min-w-0 flex-col gap-3.5"
                    aria-labelledby={`library-rediscovery-${section.id}-heading`}>
                    <SectionHeader
                        compact
                        eyebrow={section.eyebrow}
                        heading={section.heading}
                        headingId={`library-rediscovery-${section.id}-heading`}
                    />
                    <div
                        role="list"
                        className={cx(
                            'grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5',
                            'max-sm:gap-y-4'
                        )}>
                        {section.items.map(item => (
                            <div
                                key={`${item.kind}-${item.kind === 'track'
                                    ? item.music.id
                                    : item.album.id}`}
                                role="listitem"
                                className="min-w-0">
                                {item.kind === 'track' ? (
                                    <TrackCard
                                        item={item}
                                        playbackBlocked={playbackBlocked}
                                        onPlayTrack={onPlayTrack}
                                    />
                                ) : (
                                    <AlbumCard item={item} />
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
};

export default LibraryRediscoverySections;
