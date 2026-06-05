import classNames from 'classnames';
import { useNavigate } from 'react-router-dom';

import { Image } from '~/components/shared';
import MusicActionPanelContent from '../MusicActionPanelContent';
import { useStoreValue } from '~/hooks';
import * as Icon from '~/icon';
import { useAppStore as useStore } from '~/store/base-store';
import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';
import { panel } from '~/modules/panel';

const controlButtonClassName = 'relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent !text-[var(--b-color-text)] transition-[background-color,color,transform] duration-150 hover:bg-white/8 hover:!text-white active:scale-95 [&_svg]:h-[1.125rem] [&_svg]:w-[1.125rem] [&_svg]:opacity-100 [&_svg]:text-current';
const secondaryControlClassName = '!text-[var(--b-color-text-secondary)] hover:!text-[var(--b-color-text)]';

const MusicPlayer = () => {
    const navigate = useNavigate();

    const [currentTrackId] = useStoreValue(queueStore, 'currentTrackId');
    const [progress] = useStoreValue(queueStore, 'progress');
    const [isPlaying] = useStoreValue(queueStore, 'isPlaying');
    const [repeatMode] = useStoreValue(queueStore, 'repeatMode');
    const [shuffle] = useStoreValue(queueStore, 'shuffle');
    const [{ musicMap }] = useStore(musicStore);

    const currentMusic = currentTrackId
        ? musicMap.get(currentTrackId)
        : null;

    const openCurrentMusicActions = () => {
        if (!currentMusic) {
            return;
        }

        panel.open({
            title: 'More actions',
            content: (
                <MusicActionPanelContent
                    id={currentMusic.id}
                    onAlbumClick={() => navigate(`/album/${currentMusic.album.id}`)}
                    onArtistClick={() => navigate(`/artist/${currentMusic.artist.id}`)}
                />
            )
        });
    };

    // TODO: Fix type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleClickProgress = (e: any) => {
        const { width, left, right } = (e.currentTarget as HTMLDivElement).getBoundingClientRect();

        let x = e.touches ? e.touches[0].clientX : e.clientX;
        x = x < left ? left : x > right ? right : x;
        const percent = (x - left) / width;
        const duration = currentMusic?.duration || 1;

        queueStore.seek(duration * percent);
    };

    // TODO: Fix type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleMoveProgress = (e: any) => {
        if (e.buttons === 1) {
            handleClickProgress(e);
            return;
        }

        if (e.touches?.length === 1) {
            handleClickProgress(e);
        }
    };

    return (
        <div className="overflow-hidden border-t border-[var(--b-color-border-subtle)] bg-[rgba(9,9,11,0.96)] lg:col-span-2">
            <div
                className="h-[3px] w-full cursor-pointer overflow-hidden bg-[rgba(244,244,245,0.08)] transition-[height] duration-150 hover:h-1"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                onClick={handleClickProgress}
                onMouseMove={handleMoveProgress}
                onTouchMove={handleMoveProgress}>
                <div
                    className="h-full w-full bg-[var(--b-color-point)]"
                    style={{ transform: `translateX(-${100 - progress}%)` }}
                />
            </div>
            <div className="flex items-center justify-between gap-[var(--b-spacing-md)] px-[var(--b-spacing-md)] py-[var(--b-spacing-sm)] lg:px-[var(--b-spacing-lg)]">
                <button
                    type="button"
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-[var(--b-spacing-sm)] border-0 bg-transparent p-0 text-left lg:gap-[var(--b-spacing-md)]"
                    onClick={() => currentMusic && navigate('/player')}>
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[var(--b-radius-md)] bg-[var(--b-color-surface-subtle)]">
                        <Image
                            className="h-full w-full object-cover"
                            src={currentMusic?.album.cover}
                            alt={currentMusic?.album.name ?? ''}
                            loading="eager"
                            icon={<Icon.Disc />}
                        />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium text-[var(--b-color-text)]">
                            {currentMusic?.name ?? 'No music'}
                        </span>
                        <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">
                            {currentMusic?.artist.name ?? ''}
                        </span>
                    </div>
                </button>
                <div className="flex items-center gap-[var(--b-spacing-xs)]">
                    <button
                        type="button"
                        className={classNames(controlButtonClassName, secondaryControlClassName, 'max-[768px]:hidden')}
                        onClick={() => queueStore.changeRepeatMode()}>
                        {repeatMode === 'all' && <Icon.Repeat />}
                        {repeatMode === 'one' && <Icon.Infinite />}
                        {repeatMode === 'none' && <Icon.RightLeft />}
                    </button>
                    <button
                        type="button"
                        className={classNames(controlButtonClassName, secondaryControlClassName, 'max-[768px]:hidden')}
                        onClick={() => queueStore.prev()}>
                        <Icon.SkipBack />
                    </button>
                    <button
                        type="button"
                        className={classNames(controlButtonClassName, 'h-11 w-11 !bg-[var(--b-color-point)] !text-black hover:!bg-[var(--b-color-point-dark)] hover:!text-black max-[768px]:order-2 [&_svg]:h-5 [&_svg]:w-5')}
                        onClick={() => isPlaying ? queueStore.pause() : queueStore.play()}>
                        {isPlaying ? <Icon.Pause /> : <Icon.Play />}
                    </button>
                    <button
                        type="button"
                        className={classNames(controlButtonClassName, secondaryControlClassName, 'max-[768px]:hidden')}
                        onClick={() => queueStore.next()}>
                        <Icon.SkipForward />
                    </button>
                    <button
                        type="button"
                        className={classNames(controlButtonClassName, secondaryControlClassName, 'max-[768px]:hidden', shuffle && '!text-[var(--b-color-point)] hover:!text-[var(--b-color-point)] [&_svg]:!stroke-[var(--b-color-point)] [&_path]:!stroke-[var(--b-color-point)]')}
                        onClick={() => queueStore.toggleShuffle()}>
                        <Icon.Shuffle />
                    </button>
                    <button
                        type="button"
                        className={classNames(
                            controlButtonClassName,
                            secondaryControlClassName,
                            'max-[768px]:order-3',
                            currentMusic?.isLiked && '!text-[var(--b-color-point)] hover:!text-[var(--b-color-point)] [&_svg]:!fill-[var(--b-color-point)] [&_svg]:!stroke-[var(--b-color-point)]'
                        )}
                        aria-label={currentMusic?.isLiked ? 'Open more actions for liked current music' : 'Open more actions for current music'}
                        aria-haspopup="dialog"
                        disabled={!currentMusic}
                        onClick={openCurrentMusicActions}>
                        <Icon.Heart />
                    </button>
                    <button
                        type="button"
                        className={classNames(controlButtonClassName, secondaryControlClassName, 'max-[768px]:order-4')}
                        aria-label="Open queue"
                        onClick={() => navigate('/queue')}>
                        <Icon.ListMusic />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MusicPlayer;
