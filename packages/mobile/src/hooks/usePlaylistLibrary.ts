import { useCallback, useMemo, useState } from 'react';

import {
  fetchMobilePlaylist,
  fetchMobilePlaylists,
  OceanWaveMusic,
  OceanWavePlaylist,
} from '../api/oceanWaveClient';
import { ServerProfile } from '../app/serverProfiles';
import {
  deleteOfflinePlaylist,
  findOfflinePlaylist,
  listOfflinePlaylistsForServer,
  OfflinePlaylist,
  readCachedPlaylistsForServer,
  readOfflinePlaylists,
  saveOfflinePlaylist,
  SaveOfflinePlaylistProgress,
  writeCachedPlaylistsForServer,
} from '../offline/offlinePlaylists';
import { playLibraryFrom, prepareTrackPlayer } from '../player/trackPlayer';
import { isNetworkAvailable } from '../storage/nativeKeyValue';

export type MobileScreen = 'servers' | 'addServer' | 'player';


function mergePlaylistSummaries(cachedPlaylists: OceanWavePlaylist[], offlinePlaylists: OfflinePlaylist[]) {
  const byId = new Map<number, OceanWavePlaylist>();

  for (const playlist of cachedPlaylists) {
    byId.set(playlist.id, playlist);
  }

  for (const playlist of offlinePlaylists) {
    if (byId.has(playlist.playlistId)) continue;
    byId.set(playlist.playlistId, {
      id: playlist.playlistId,
      name: playlist.playlistName,
      musicCount: playlist.tracks.length,
    });
  }

  return Array.from(byId.values());
}

type UsePlaylistLibraryOptions = {
  setIsLoading: (value: boolean) => void;
  setMessage: (value: string) => void;
  setScreen: (value: MobileScreen) => void;
};

export function usePlaylistLibrary({ setIsLoading, setMessage, setScreen }: UsePlaylistLibraryOptions) {
  const [searchQuery, setSearchQuery] = useState('');
  const [library, setLibrary] = useState<OceanWaveMusic[]>([]);
  const [playlists, setPlaylists] = useState<OceanWavePlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [selectedPlaylistName, setSelectedPlaylistName] = useState<string | null>(null);
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  const [pendingTrack, setPendingTrack] = useState<OceanWaveMusic | null>(null);
  const [offlinePlaylists, setOfflinePlaylists] = useState<OfflinePlaylist[]>([]);
  const [offlineSaveProgress, setOfflineSaveProgress] = useState<SaveOfflinePlaylistProgress | null>(null);

  const visibleLibrary = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return library;

    return library.filter(item => [item.name, item.artist?.name, item.album?.name]
      .filter(Boolean)
      .some(value => value?.toLowerCase().includes(normalizedQuery)));
  }, [library, searchQuery]);

  const resetQueueState = useCallback(() => {
    setLibrary([]);
    setPlaylists([]);
    setSelectedPlaylistId(null);
    setSelectedPlaylistName(null);
    setPendingTrack(null);
    setPendingTrackId(null);
    setOfflineSaveProgress(null);
    setSearchQuery('');
  }, []);

  const refreshOfflinePlaylists = useCallback(async () => {
    const nextOfflinePlaylists = await readOfflinePlaylists();
    setOfflinePlaylists(nextOfflinePlaylists);
    return nextOfflinePlaylists;
  }, []);

  const applyOfflinePlaylist = useCallback((offlinePlaylist: OfflinePlaylist) => {
    setLibrary(offlinePlaylist.tracks);
    setSelectedPlaylistId(offlinePlaylist.playlistId);
    setSelectedPlaylistName(offlinePlaylist.playlistName);
    setSearchQuery('');
    setScreen('player');
  }, [setScreen]);


  const loadCachedServerContent = useCallback(async (profile: ServerProfile) => {
    const [savedPlaylists, cachedPlaylists] = await Promise.all([
      refreshOfflinePlaylists(),
      readCachedPlaylistsForServer(profile.url),
    ]);
    const offlineServerPlaylists = listOfflinePlaylistsForServer(savedPlaylists, profile.url);
    const playlistSummaries = mergePlaylistSummaries(cachedPlaylists, offlineServerPlaylists);
    const focusedPlaylist = playlistSummaries.find(playlist => playlist.id === selectedPlaylistId) ?? playlistSummaries[0];
    const offlineFallback = focusedPlaylist
      ? findOfflinePlaylist(savedPlaylists, profile.url, focusedPlaylist.id)
      : null;

    setPlaylists(playlistSummaries);
    setSearchQuery('');
    setScreen('player');
    prepareTrackPlayer().catch(() => undefined);

    if (offlineFallback) {
      applyOfflinePlaylist(offlineFallback);
      setMessage(`${offlineFallback.playlistName} is available offline. Syncing server…`);
      return true;
    }

    if (focusedPlaylist) {
      setLibrary([]);
      setSelectedPlaylistId(focusedPlaylist.id);
      setSelectedPlaylistName(focusedPlaylist.name);
      setMessage(`${focusedPlaylist.name} will load when the server responds.`);
      return true;
    }

    setLibrary([]);
    setSelectedPlaylistId(null);
    setSelectedPlaylistName(null);
    setMessage('Syncing server…');
    return false;
  }, [applyOfflinePlaylist, refreshOfflinePlaylists, selectedPlaylistId, setMessage, setScreen]);

  const loadServerContent = useCallback(async (profile: ServerProfile, options: { showLoading?: boolean } = {}) => {
    const { showLoading = true } = options;
    if (showLoading) setIsLoading(true);
    setMessage('Loading playlists…');
    setPendingTrack(null);
    setPendingTrackId(null);
    await refreshOfflinePlaylists();
    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) {
      await loadCachedServerContent(profile);
      setMessage('No network connection. Showing local content.');
      if (showLoading) setIsLoading(false);
      return false;
    }

    try {
      const nextPlaylists = await fetchMobilePlaylists(profile.url, profile.sessionCookie);
      await writeCachedPlaylistsForServer(profile.url, nextPlaylists);
      const focusedPlaylist = nextPlaylists.find(playlist => playlist.id === selectedPlaylistId) ?? nextPlaylists[0];

      setPlaylists(nextPlaylists);
      setSearchQuery('');
      setScreen('player');
      prepareTrackPlayer().catch(() => undefined);

      if (!focusedPlaylist) {
        setLibrary([]);
        setSelectedPlaylistId(null);
        setSelectedPlaylistName(null);
        setMessage('No playlists yet. Create one in the web app first.');
        return true;
      }

      const playlist = await fetchMobilePlaylist(profile.url, focusedPlaylist.id, profile.sessionCookie);
      const nextMusics = playlist?.musics ?? [];
      setLibrary(nextMusics);
      setSelectedPlaylistId(focusedPlaylist.id);
      setSelectedPlaylistName(playlist?.name ?? focusedPlaylist.name);
      setMessage(`${playlist?.name ?? focusedPlaylist.name} ready.`);
      return true;
    } catch (error) {
      await loadCachedServerContent(profile);
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [loadCachedServerContent, refreshOfflinePlaylists, selectedPlaylistId, setIsLoading, setMessage, setScreen]);

  const openPlaylist = useCallback(async (profile: ServerProfile | null, playlistId: number) => {
    if (!profile) return;

    const pendingPlaylist = playlists.find(playlist => playlist.id === playlistId);
    const savedPlaylists = await refreshOfflinePlaylists();
    const offlinePlaylist = findOfflinePlaylist(savedPlaylists, profile.url, playlistId);

    setIsLoading(!offlinePlaylist);
    setSelectedPlaylistId(playlistId);
    setSelectedPlaylistName(pendingPlaylist?.name ?? null);
    setPendingTrack(null);
    setPendingTrackId(null);
    if (offlinePlaylist) {
      applyOfflinePlaylist(offlinePlaylist);
      setMessage(`${offlinePlaylist.playlistName} is available offline. Syncing server…`);
    } else {
      setLibrary([]);
    }
    setSearchQuery('');
    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) {
      setMessage(offlinePlaylist ? `${offlinePlaylist.playlistName} is available offline.` : 'No network connection. Connect to the server network to load this playlist.');
      setIsLoading(false);
      return;
    }

    try {
      const playlist = await fetchMobilePlaylist(profile.url, playlistId, profile.sessionCookie);
      const nextMusics = playlist?.musics ?? [];
      setSelectedPlaylistId(playlist?.id ?? playlistId);
      setSelectedPlaylistName(playlist?.name ?? null);
      setLibrary(nextMusics);
      setMessage(playlist ? `${playlist.name} is now your queue.` : 'Playlist not found.');
    } catch (error) {
      if (offlinePlaylist) {
        setMessage(`${offlinePlaylist.playlistName} is available offline. Server sync failed.`);
      } else {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setIsLoading(false);
    }
  }, [applyOfflinePlaylist, playlists, refreshOfflinePlaylists, setIsLoading, setMessage]);

  const playTrack = useCallback(async (profile: ServerProfile | null, index: number) => {
    if (!profile || !visibleLibrary.length) return;
    const selectedMusic = visibleLibrary[index];
    if (!selectedMusic) return;
    setPendingTrackId(String(selectedMusic.id));
    setPendingTrack(selectedMusic);
    setMessage(`Starting ${selectedMusic.name}…`);
    try {
      await playLibraryFrom(profile.url, visibleLibrary, index, profile.sessionCookie);
      setMessage(`Playing ${selectedMusic.name}.`);
    } catch (error) {
      setPendingTrackId(null);
      setPendingTrack(null);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [setMessage, visibleLibrary]);

  const clearPendingTrackId = useCallback(() => {
    setPendingTrackId(null);
    setPendingTrack(null);
  }, []);

  const saveSelectedPlaylistOffline = useCallback(async (profile: ServerProfile | null) => {
    if (!profile || !selectedPlaylistId || !selectedPlaylistName || !library.length) return;
    setOfflineSaveProgress({ completed: 0, total: library.length });
    setMessage(`Downloading ${selectedPlaylistName} for offline playback…`);
    try {
      await saveOfflinePlaylist(profile, selectedPlaylistId, selectedPlaylistName, library, setOfflineSaveProgress);
      await refreshOfflinePlaylists();
      setMessage(`${selectedPlaylistName} downloaded for offline playback.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setOfflineSaveProgress(null);
    }
  }, [library, refreshOfflinePlaylists, selectedPlaylistId, selectedPlaylistName, setMessage]);

  const deleteSelectedOfflinePlaylist = useCallback(async (profile: ServerProfile | null) => {
    if (!profile || !selectedPlaylistId) return;
    const nextOfflinePlaylists = await deleteOfflinePlaylist(profile.url, selectedPlaylistId);
    setOfflinePlaylists(nextOfflinePlaylists);
    setMessage('Downloaded playlist removed.');
  }, [selectedPlaylistId, setMessage]);

  return {
    library,
    loadCachedServerContent,
    loadServerContent,
    openPlaylist,
    clearPendingTrackId,
    pendingTrackId,
    pendingTrack,
    deleteSelectedOfflinePlaylist,
    offlinePlaylists,
    offlineSaveProgress,
    playTrack,
    playlists,
    resetQueueState,
    searchQuery,
    selectedPlaylistId,
    selectedPlaylistName,
    setLibrary,
    setPlaylists,
    setSearchQuery,
    setSelectedPlaylistId,
    setSelectedPlaylistName,
    saveSelectedPlaylistOffline,
    visibleLibrary,
  };
}
