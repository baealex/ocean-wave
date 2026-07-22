import { useEffect, useState } from 'react';
import { getPlaylistOfflineAssets } from '~/api/offline-playlists';
import { Button, SettingItem, SettingSection, Text } from '~/components/shared';
import useStoreValue from '~/hooks/useStoreValue';
import { readOfflinePlaylists, removeOfflinePlaylist, type OfflinePlaylistState, updateOfflinePlaylist, writeOfflinePlaylists } from '~/modules/offline-playlists';
import { toast } from '~/modules/toast';
import { playlistStore } from '~/store/playlist';

const send = async (message: unknown) => (await navigator.serviceWorker.ready).active?.postMessage(message);
const formatBytes = (value: number) => `${(value / 1024 / 1024).toFixed(value > 100 * 1024 * 1024 ? 0 : 1)} MB`;

export const OfflineListeningSection = () => {
    const [playlists] = useStoreValue(playlistStore, 'playlists');
    const [states, setStates] = useState<OfflinePlaylistState[]>(readOfflinePlaylists);
    const [quota, setQuota] = useState<{ usage: number; quota: number }>();
    useEffect(() => {
        navigator.storage?.estimate().then(value => setQuota({ usage: value.usage ?? 0, quota: value.quota ?? 0 }));
        const listener = (event: MessageEvent) => {
            const data = event.data;
            if (!data?.playlistId || !String(data.type).startsWith('OFFLINE_')) return;
            setStates(previous => {
                if (data.type === 'OFFLINE_REMOVED') {
                    const next = removeOfflinePlaylist(previous, String(data.playlistId));
                    writeOfflinePlaylists(next);
                    return next;
                }
                const current = previous.find(item => item.playlistId === String(data.playlistId));
                const nextState: OfflinePlaylistState = {
                    playlistId: String(data.playlistId),
                    status: data.type === 'OFFLINE_COMPLETE' ? 'complete' : data.type === 'OFFLINE_FAILED' ? 'failed' : 'downloading',
                    completed: data.completed ?? data.count ?? current?.completed ?? 0,
                    total: data.total ?? data.count ?? current?.total ?? 0,
                    message: data.message
                };
                const next = updateOfflinePlaylist(previous, nextState);
                writeOfflinePlaylists(next);
                return next;
            });
        };
        navigator.serviceWorker?.addEventListener('message', listener);
        return () => navigator.serviceWorker?.removeEventListener('message', listener);
    }, []);
    if (!('serviceWorker' in navigator)) return null;
    const download = async (playlistId: string) => {
        const assets = await getPlaylistOfflineAssets(playlistId);
        const estimate = await navigator.storage?.estimate();
        if (estimate?.quota && assets.totalBytes > estimate.quota - (estimate.usage ?? 0)) {
            toast.error(`This playlist needs about ${formatBytes(assets.totalBytes)}, but browser storage is low.`);
            return;
        }
        const next = updateOfflinePlaylist(states, { playlistId, status: 'downloading', completed: 0, total: assets.urls.length });
        setStates(next);
        writeOfflinePlaylists(next);
        await send({ type: 'DOWNLOAD_PLAYLIST', playlistId, urls: assets.urls });
    };
    return (
        <SettingSection title="Offline listening" description="Download selected playlists in the installed web app. Partial downloads are discarded safely.">
            {quota && <div className="border-b border-[var(--b-color-border-subtle)] py-3"><Text as="p" size="xs" variant="muted">Browser storage: {formatBytes(quota.usage)} used of {formatBytes(quota.quota)}</Text></div>}
            {playlists.map(playlist => {
                const state = states.find(item => item.playlistId === playlist.id);
                const description = state?.status === 'complete'
                    ? `${state.total} songs available offline`
                    : state?.status === 'downloading'
                        ? `Downloading ${state.completed} of ${state.total}`
                        : state?.status === 'failed'
                            ? state.message ?? 'Download failed; retry when ready.'
                            : 'Requires a server connection until downloaded.';
                return <SettingItem key={playlist.id} title={playlist.name} description={description}>
                    {state?.status === 'complete'
                        ? <Button onClick={() => send({ type: 'REMOVE_PLAYLIST', playlistId: playlist.id })}>Remove</Button>
                        : <Button disabled={state?.status === 'downloading'} onClick={() => download(playlist.id)}>{state?.status === 'failed' ? 'Retry' : 'Download'}</Button>}
                </SettingItem>;
            })}
            {playlists.length === 0 && <div className="py-4"><Text as="p" size="sm" variant="muted">Create a playlist before downloading music.</Text></div>}
        </SettingSection>
    );
};
