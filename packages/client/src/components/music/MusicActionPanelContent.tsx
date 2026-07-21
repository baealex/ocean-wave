import { useAppStore as useStore } from '~/store/base-store';
import { useNavigate } from 'react-router-dom';

import { Image, PanelContent } from '~/components/shared';
import { PanelHeaderAction, panelContentClass } from '~/components/shared/PanelContent';
import { PlaylistPanelContent } from '~/components/playlist';
import MusicTagPanelContent from './MusicTagPanelContent';
import PersonalListeningSessionOptionsPanelContent from './PersonalListeningSessionOptionsPanelContent';

import * as Icon from '~/icon';

import { panel } from '~/modules/panel';
import { toast } from '~/modules/toast';
import { makePlayTime } from '~/modules/time';
import { DEFAULT_PERSONAL_LISTENING_SESSION_OPTIONS } from '~/modules/personal-listening-session';
import { MusicListener, PlaylistListener } from '~/socket';
import { usePersonalListeningSessionStarter } from '~/hooks/usePersonalListeningSessionStarter';

import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';

interface MusicActionPanelContentProps {
    id: string;
    onArtistClick?: () => void;
    onAlbumClick?: () => void;
}

export default function MusicActionPanelContent({
    id,
    onArtistClick,
    onAlbumClick
}: MusicActionPanelContentProps) {
    const navigate = useNavigate();
    const [{ musicMap }] = useStore(musicStore);
    const sessionStarter = usePersonalListeningSessionStarter();

    const music = musicMap.get(id);

    if (!music) {
        return null;
    }

    const header = (onAlbumClick || onArtistClick) ? (
        <>
            {onAlbumClick && (
                <PanelHeaderAction
                    layout="album"
                    onClick={() => {
                        panel.close();
                        setTimeout(onAlbumClick, 100);
                    }}>
                    <Image
                        className={panelContentClass.cover}
                        src={music.album.cover}
                        alt={music.album.name}
                    />
                    <div>
                        <div className={panelContentClass.subTitle}>Album</div>
                        <div className={panelContentClass.subContent}>
                            {music.album.name}
                        </div>
                    </div>
                </PanelHeaderAction>
            )}
            {onArtistClick && (
                <PanelHeaderAction
                    layout="artist"
                    onClick={() => {
                        panel.close();
                        setTimeout(onArtistClick, 100);
                    }}>
                    <div>
                        <div className={panelContentClass.subTitle}>Artist</div>
                        <div className={panelContentClass.subContent}>
                            {music.artist.name}
                        </div>
                    </div>
                </PanelHeaderAction>
            )}
        </>
    ) : undefined;

    return (
        <PanelContent
            header={header}
            items={[
                {
                    id: 'like',
                    icon: <Icon.Heart />,
                    text: music.isLiked ? 'Liked' : 'Like',
                    filled: music.isLiked,
                    active: music.isLiked,
                    onClick: () => MusicListener.like(music.id, !music.isLiked)
                },
                {
                    id: 'start-session',
                    icon: <Icon.ListMusic />,
                    text: sessionStarter.starting
                        ? 'Starting session…'
                        : sessionStarter.message ? 'Retry session' : 'Start a session',
                    description: sessionStarter.message
                        ?? 'Play a balanced session related to this track.',
                    descriptionRole: sessionStarter.message ? 'alert' : undefined,
                    disabled: sessionStarter.starting,
                    onClick: () => void sessionStarter.start({
                        ...DEFAULT_PERSONAL_LISTENING_SESSION_OPTIONS,
                        startMusicId: music.id
                    })
                },
                {
                    id: 'session-options',
                    icon: <Icon.Shuffle />,
                    text: 'Session options',
                    description: 'Choose the length and how closely tracks should match.',
                    disabled: sessionStarter.starting,
                    onClick: () => {
                        panel.open({
                            title: 'Session options',
                            content: (
                                <PersonalListeningSessionOptionsPanelContent
                                    musicName={music.name}
                                    startMusicId={music.id}
                                />
                            )
                        });
                    }
                },
                {
                    icon: <Icon.Play />,
                    text: 'Add to Queue',
                    onClick: () => queueStore.add(music.id)
                },
                {
                    icon: <Icon.List />,
                    text: 'Add to Playlist',
                    onClick: () => {
                        panel.close();
                        panel.open({
                            title: 'Add to Playlist',
                            content: (
                                <PlaylistPanelContent
                                    createAndAddMusicIds={[music.id]}
                                    onClick={(id) => {
                                        PlaylistListener.addMusic(id, [music.id]);
                                        toast('Added to playlist');
                                    }}
                                />
                            )
                        });
                    }
                },
                {
                    icon: <Icon.Tags />,
                    text: 'Tags',
                    description: music.tags.length > 0
                        ? music.tags.map(tag => tag.name).join(', ')
                        : 'No tags on this track.',
                    onClick: () => {
                        panel.close();
                        panel.open({
                            title: 'Music Tags',
                            content: <MusicTagPanelContent id={music.id} />
                        });
                    }
                },
                {
                    icon: <Icon.Pencil />,
                    text: 'Edit track',
                    onClick: () => {
                        panel.close();
                        setTimeout(() => navigate(`/music/${music.id}/edit`), 100);
                    }
                },
                {
                    icon: <Icon.Download />,
                    text: 'Download',
                    onClick: () => {
                        queueStore.download(music.id);
                        panel.close();
                    }
                },
                {
                    icon: <Icon.Close />,
                    text: music.isHated ? 'Show again this music' : 'Hide this music',
                    onClick: () => MusicListener.hate(music.id, !music.isHated)
                }
            ]}
            footer={(
                <>
                    <span>listen: {music.playCount} times</span> /
                    <span>duration: {makePlayTime(music.duration)}</span> /
                    <span>codec: {music.codec}</span>
                </>
            )}
        />
    );
}
