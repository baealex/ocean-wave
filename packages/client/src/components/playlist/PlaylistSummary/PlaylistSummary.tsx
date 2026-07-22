import { useAppStore as useStore } from '~/store/base-store';

import { GridImage, SummaryTitle, Text } from '~/components/shared';

import type { Playlist } from '~/models/type';

import { musicStore } from '~/store/music';

type PlaylistSummaryProps = Pick<Playlist, 'name' | 'musics'>;

const PlaylistSummary = ({ musics, name }: PlaylistSummaryProps) => {
    const [{ musicMap }] = useStore(musicStore);

    return (
        <div className="flex flex-col items-center justify-center gap-[var(--b-spacing-lg)] text-center lg:flex-row lg:justify-start lg:gap-[var(--b-spacing-xl)] lg:text-left">
            <GridImage
                className="w-[min(52vw,200px)] shrink-0 rounded-[var(--b-radius-xl)] shadow-[var(--b-shadow-artwork-summary)] lg:w-[180px]"
                images={(musics ?? []).slice(0, 16).map((music) => musicMap.get(music.id)?.album.cover ?? '')}
            />
            <div className="flex min-w-0 flex-col items-center gap-2.5 lg:items-start">
                <Text as="span" variant="muted" size="overline" weight="medium">
                    Playlist
                </Text>
                <SummaryTitle as="h1" className="max-w-full lg:text-left">
                    {name}
                </SummaryTitle>
                <Text variant="tertiary" size="sm">
                    {musics.length.toLocaleString()} {musics.length === 1 ? 'song' : 'songs'}
                </Text>
            </div>
        </div>
    );
};

export default PlaylistSummary;
