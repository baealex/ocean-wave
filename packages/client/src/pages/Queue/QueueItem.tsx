import classNames from 'classnames';
import type {
    ButtonHTMLAttributes,
    CSSProperties
} from 'react';

import {
    Badge,
    IconButton,
    Image,
    listRowButtonContentClass,
    listRowClass,
    SelectionCheckButton,
    Text
} from '~/components/shared';
import * as Icon from '~/icon';

import type { Music } from '~/models/type';
import {
    REMOTE_PLAYBACK_OWNERSHIP_MESSAGE,
    REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
} from '~/modules/playback-ownership';
import type { QueueTone } from './QueueDndItem';

const cx = classNames;

interface QueueItemProps {
    className?: string;
    music: Music;
    index: number;
    tone: QueueTone;
    isSelectMode: boolean;
    isSelected: boolean;
    playbackDisabled?: boolean;
    sessionReason?: string | null;
    onSelect: () => void;
    onClick: () => void;
    onOpenActions: () => void;
    onReorderKeyDown?: ButtonHTMLAttributes<HTMLButtonElement>['onKeyDown'];
    onReorderPointerDown?: ButtonHTMLAttributes<HTMLButtonElement>['onPointerDown'];
    style?: CSSProperties;
}

export default function QueueItem({
    className,
    music,
    index,
    tone,
    isSelectMode,
    isSelected,
    playbackDisabled = false,
    sessionReason = null,
    onSelect,
    onClick,
    onOpenActions,
    onReorderKeyDown,
    onReorderPointerDown,
    style
}: QueueItemProps) {
    return (
        <li
            data-queue-index={index}
            style={style}
            className={cx(
                listRowClass({
                    layout: 'queue',
                    surface: 'queue',
                    tone,
                    selected: isSelected
                }),
                className
            )}>
            {isSelectMode ? (
                <SelectionCheckButton
                    selected={isSelected}
                    className="ml-1"
                    aria-label={isSelected ? `Unselect ${music.name}` : `Select ${music.name}`}
                    aria-pressed={isSelected}
                    onClick={onSelect}
                />
            ) : (
                <IconButton
                    size="sm"
                    tone="neutral"
                    className="ml-1 cursor-grab touch-none text-[var(--b-color-text-muted)]"
                    aria-label={`Move ${music.name} in queue`}
                    onKeyDown={onReorderKeyDown}
                    onPointerDown={onReorderPointerDown}>
                    <Icon.Menu />
                </IconButton>
            )}

            <button
                type="button"
                className={cx(
                    listRowButtonContentClass({ layout: 'queue' }),
                    playbackDisabled && 'cursor-not-allowed opacity-60'
                )}
                disabled={!isSelectMode && playbackDisabled}
                aria-label={!isSelectMode && playbackDisabled
                    ? `${music.name} cannot start here while another device owns playback`
                    : undefined}
                aria-describedby={!isSelectMode && playbackDisabled
                    ? REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
                    : undefined}
                title={!isSelectMode && playbackDisabled
                    ? REMOTE_PLAYBACK_OWNERSHIP_MESSAGE
                    : undefined}
                onClick={isSelectMode ? onSelect : onClick}
                onContextMenu={(e) => {
                    e.preventDefault();

                    if (!isSelectMode) {
                        onOpenActions();
                    }
                }}>
                <Image
                    className="h-[52px] w-[52px] shrink-0 rounded-[var(--b-radius-lg)] object-cover shadow-[var(--b-shadow-queue-artwork)] max-sm:h-12 max-sm:w-12"
                    src={music.album.cover}
                    alt={music.album.name}
                    loading="eager"
                    icon={<Icon.Disc />}
                />

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                        <Text
                            as="span"
                            size="sm"
                            weight="medium"
                            className="truncate">
                            {music.name}
                        </Text>
                        {tone === 'current' && (
                            <Badge tone="subtle" className="shrink-0 uppercase">Now</Badge>
                        )}
                    </div>

                    <Text as="span" variant="secondary" size="sm" className="truncate">
                        {music.artist.name}
                        {sessionReason ? ` · ${sessionReason}` : ''}
                    </Text>
                </div>
            </button>

            {!isSelectMode && (
                <IconButton
                    size="sm"
                    tone="neutral"
                    className="mr-1 text-[var(--b-color-text-muted)]"
                    aria-label={`Open actions for ${music.name}`}
                    onClick={onOpenActions}>
                    <Icon.VerticalDots />
                </IconButton>
            )}
        </li>
    );
}
