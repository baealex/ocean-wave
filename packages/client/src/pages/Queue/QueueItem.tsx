import type {
    ButtonHTMLAttributes,
    CSSProperties
} from 'react';

import classNames from 'classnames';

import { Image, Text } from '~/components/shared';
import * as Icon from '~/icon';

import type { Music } from '~/models/type';

import type { QueueTone } from './QueueDndItem';

const cx = classNames;

interface QueueItemProps {
    className?: string;
    music: Music;
    index: number;
    tone: QueueTone;
    isSelectMode: boolean;
    isSelected: boolean;
    onSelect: () => void;
    onClick: () => void;
    onOpenActions: () => void;
    onReorderPointerDown?: ButtonHTMLAttributes<HTMLButtonElement>['onPointerDown'];
    style?: CSSProperties;
}

const queueItemToneClass: Record<QueueTone, string> = {
    current: 'border-[var(--b-color-focus)] bg-[var(--b-color-surface-item)]',
    past: 'opacity-70',
    upcoming: ''
};

const iconButtonClass = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-[var(--b-color-text-muted)] transition-[color,background-color] duration-150 hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] [&_svg]:h-4 [&_svg]:w-4';

export default function QueueItem({
    className,
    music,
    index,
    tone,
    isSelectMode,
    isSelected,
    onSelect,
    onClick,
    onOpenActions,
    onReorderPointerDown,
    style
}: QueueItemProps) {
    return (
        <li
            data-queue-index={index}
            style={style}
            className={cx(
                'flex min-h-[4.25rem] items-center gap-2 rounded-2xl border border-transparent bg-[var(--b-color-surface-subtle)] transition-[background-color,border-color,opacity] duration-150 hover:bg-[linear-gradient(90deg,var(--b-color-surface-subtle),var(--b-color-surface-subtle)),var(--b-gradient-row-hover)] max-sm:min-h-[4.125rem] max-sm:gap-1.5',
                queueItemToneClass[tone],
                isSelected && 'bg-[var(--b-color-surface-item)]',
                className
            )}>
            {isSelectMode ? (
                <button
                    type="button"
                    className={cx(iconButtonClass, 'ml-1', isSelected && '!bg-[rgba(139,92,246,0.18)] !text-[var(--b-color-point-light)] hover:!bg-[rgba(139,92,246,0.24)] hover:!text-[var(--b-color-point-light)] [&_svg]:fill-none [&_svg]:text-current')}
                    aria-label={isSelected ? `Unselect ${music.name}` : `Select ${music.name}`}
                    aria-pressed={isSelected}
                    onClick={onSelect}>
                    <Icon.CheckBox />
                </button>
            ) : (
                <button
                    type="button"
                    className={cx(iconButtonClass, 'ml-1 cursor-grab touch-none')}
                    aria-label={`Reorder ${music.name}`}
                    onPointerDown={onReorderPointerDown}>
                    <Icon.Menu />
                </button>
            )}

            <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3.5 border-0 bg-transparent py-2.5 text-left text-inherit max-sm:gap-3 max-sm:pr-0.5"
                onClick={isSelectMode ? onSelect : onClick}
                onContextMenu={(e) => {
                    e.preventDefault();

                    if (!isSelectMode) {
                        onOpenActions();
                    }
                }}>
                <Image
                    className="h-[3.25rem] w-[3.25rem] shrink-0 rounded-[0.95rem] object-cover shadow-[0_10px_20px_rgba(2,8,11,0.12)] max-sm:h-12 max-sm:w-12"
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
                            <span className="shrink-0 rounded-full bg-[var(--b-color-border-subtle)] px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-normal text-[var(--b-color-text-secondary)]">Now</span>
                        )}
                    </div>

                    <Text as="span" variant="secondary" size="sm" className="truncate">
                        {music.artist.name}
                    </Text>
                </div>
            </button>

            {!isSelectMode && (
                <button
                    type="button"
                    className={cx(iconButtonClass, 'mr-1')}
                    aria-label={`Open actions for ${music.name}`}
                    onClick={onOpenActions}>
                    <Icon.VerticalDots />
                </button>
            )}
        </li>
    );
}
