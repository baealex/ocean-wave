import classNames from 'classnames';

import { Image } from '~/components/shared';
import { getOriginalImage } from '~/modules/image';

const cx = classNames;

interface MusicPlayerDiskStyleProps {
    isPlaying: boolean;
    src: string;
    alt: string;
}

const discClassName = 'relative h-full w-full overflow-hidden rounded-full border border-[var(--b-color-border-subtle)] bg-[radial-gradient(circle_at_50%_50%,var(--b-color-background)_0_9%,transparent_9.5%),repeating-radial-gradient(circle_at_50%_50%,transparent_0_13px,var(--b-color-disk-groove)_13px_14px),conic-gradient(from_135deg,var(--b-color-background)_0deg,var(--b-color-background-layer-1)_46deg,var(--b-color-background-layer-2)_72deg,var(--b-color-surface-input)_126deg,var(--b-color-active)_130deg,var(--b-color-surface-input)_138deg,var(--b-color-background-layer-2)_214deg,var(--b-color-background-layer-1)_282deg,var(--b-color-background)_360deg)] shadow-none before:pointer-events-none before:absolute before:in-[5%] before:rounded-full before:border before:border-[var(--b-color-border)] before:shadow-[inset_0_0_0_18px_var(--b-color-disk-inset-highlight),inset_0_0_0_42px_var(--b-color-disk-inset-shadow-strong),inset_0_0_0_68px_var(--b-color-disk-inset-highlight),inset_0_0_0_96px_var(--b-color-disk-inset-shadow)] before:content-[\'\'] after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:bg-[linear-gradient(118deg,transparent_0_42%,var(--b-color-disk-sheen)_47%,transparent_54%),radial-gradient(circle_at_50%_50%,transparent_0_62%,var(--b-color-disk-edge-shadow)_100%)] after:opacity-[0.62] after:mix-blend-screen after:content-[\'\']';

const MusicPlayerDiskStyle = ({ isPlaying, src, alt }: MusicPlayerDiskStyleProps) => {
    return (
        <div className="relative h-full w-full">
            <div
                className={cx(discClassName, 'music-player-disk')}
                data-playing={isPlaying ? 'true' : 'false'}>
                <div className="absolute inset-[24%] overflow-hidden rounded-full border border-[var(--b-color-border)] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-[radial-gradient(circle_at_50%_50%,transparent_0_58%,var(--b-color-disk-image-edge)_100%)] after:content-['']">
                    <Image
                        className="h-full w-full object-cover"
                        src={getOriginalImage(src)}
                        alt={alt}
                        loading="eager"
                    />
                </div>
                <span className="pointer-events-none absolute left-1/2 top-1/2 z-[2] h-[16%] w-[16%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--b-color-border)] bg-[radial-gradient(circle_at_50%_50%,var(--b-color-background)_0_36%,var(--b-color-background-layer-1)_38%_62%,var(--b-color-background)_64%_100%)] shadow-none after:absolute after:inset-[38%] after:rounded-[inherit] after:bg-[var(--b-color-point)] after:content-['']" />
            </div>
        </div>
    );
};

export default MusicPlayerDiskStyle;
