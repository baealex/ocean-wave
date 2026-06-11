import { useAppStore as useStore } from '~/store/base-store';

import { GridImage, SummaryTitle } from '~/components/shared';

import type { Playlist } from '~/models/type';

import { musicStore } from '~/store/music';

type PlaylistSummaryProps = Pick<Playlist, 'name' | 'musics'>;

const PlaylistSummary = ({ musics, name }: PlaylistSummaryProps) => {
    const [{ musicMap }] = useStore(musicStore);

    return (
        <div className="flex flex-col items-center justify-center gap-[var(--b-spacing-md)] text-center">
            <GridImage
                className="mb-[var(--b-spacing-sm)] w-[260px] max-w-[76%] rounded-[var(--b-radius-xl)] shadow-[var(--b-shadow-artwork-summary)]"
                images={(musics ?? []).slice(0, 16).map((music) => musicMap.get(music.id)?.album.cover ?? '')}
            />
            <SummaryTitle as="h1">
                {name}
            </SummaryTitle>
        </div>
    );
};

export default PlaylistSummary;
