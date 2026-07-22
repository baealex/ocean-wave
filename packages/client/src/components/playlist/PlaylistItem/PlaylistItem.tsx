import { useAppStore as useStore } from '~/store/base-store';

import { IconButton, libraryRowClass, PlaylistArtwork } from '~/components/shared';
import { VerticalDots } from '~/icon';

import type { Music } from '~/models/type';

import { musicStore } from '~/store/music';

interface PlaylistItemProps {
    name: string;
    headerMusics: Pick<Music, 'id'>[];
    musicCount: number;
    layout?: 'list' | 'collection' | 'reorder';
    onClick?: () => void;
    onLongPress?: () => void;
}

export default function PlaylistItem({
    name,
    headerMusics,
    musicCount,
    layout = 'list',
    onClick,
    onLongPress
}: PlaylistItemProps) {
    const [{ musicMap }] = useStore(musicStore);

    return (
        <div className={`flex w-full min-w-0 items-center ${layout === 'collection' ? 'gap-1' : ''}`}>
            <button
                type="button"
                className={libraryRowClass({
                    layout: layout === 'collection'
                        ? 'playlist'
                        : layout === 'reorder'
                            ? 'playlistReorder'
                            : 'list'
                })}
                onClick={onClick}
                onContextMenu={(e) => {
                    e.preventDefault();
                    onLongPress?.();
                }}>
                <PlaylistArtwork images={headerMusics.map((music) => musicMap.get(music.id)?.album.cover ?? '')} />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                    <span className={`${layout === 'collection' ? 'line-clamp-2' : 'truncate'} text-sm font-medium text-[var(--b-color-text)]`}>{name}</span>
                    <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">
                        {musicCount} {musicCount === 1 ? 'song' : 'songs'}
                    </span>
                </span>
            </button>
            {onLongPress && (
                <IconButton
                    aria-label={`Open actions for ${name}`}
                    className={layout === 'collection' ? '' : 'mr-2'}
                    onClick={(e) => {
                        e.stopPropagation();
                        onLongPress();
                    }}>
                    <VerticalDots />
                </IconButton>
            )}
        </div>
    );
}
