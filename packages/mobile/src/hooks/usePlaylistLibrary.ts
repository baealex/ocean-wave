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
  readOfflinePlaylists,
  saveOfflinePlaylist,
  SaveOfflinePlaylistProgress,
} from '../offline/offlinePlaylists';
import { playLibraryFrom, prepareTrackPlayer } from '../player/trackPlayer';

export type MobileScreen = 'servers' | 'addServer' | 'player';

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

  const loadServerContent = useCallback(async (profile: ServerProfile) => {
    setIsLoading(true);
    setMessage('Loading playlists…');
    setPendingTrack(null);
    setPendingTrackId(null);
    const savedPlaylists = await refreshOfflinePlaylists();
    try {
      const nextPlaylists = await fetchMobilePlaylists(profile.url, profile.sessionCookie);
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
      const offlineFallback = listOfflinePlaylistsForServer(savedPlaylists, profile.url)[0];
      if (offlineFallback) {
        setPlaylists(listOfflinePlaylistsForServer(savedPlaylists, profile.url).map(playlist => ({
          id: playlist.playlistId,
          name: playlist.playlistName,
          musicCount: playlist.tracks.length,
        })));
        applyOfflinePlaylist(offlineFallback);
        setMessage(`${offlineFallback.playlistName} is available offline.`);
        return true;
      } else {
        setMessage(error instanceof Error ? error.message : String(error));
        return false;
      }
    } finally {
      setIsLoading(false);
    }
  }, [applyOfflinePlaylist, refreshOfflinePlaylists, selectedPlaylistId, setIsLoading, setMessage, setScreen]);

  const openPlaylist = useCallback(async (profile: ServerProfile | null, isAuthenticated: boolean, playlistId: number) => {
    if (!profile) return;

    const pendingPlaylist = playlists.find(playlist => playlist.id === playlistId);
    setIsLoading(true);
    setSelectedPlaylistId(playlistId);
    setSelectedPlaylistName(pendingPlaylist?.name ?? null);
    setPendingTrack(null);
    setPendingTrackId(null);
    setLibrary([]);
    setSearchQuery('');
    try {
      if (!isAuthenticated) {
        throw new Error('Server sign-in required.');
      }
      const playlist = await fetchMobilePlaylist(profile.url, playlistId, profile.sessionCookie);
      const nextMusics = playlist?.musics ?? [];
      setSelectedPlaylistId(playlist?.id ?? playlistId);
      setSelectedPlaylistName(playlist?.name ?? null);
      setLibrary(nextMusics);
      setMessage(playlist ? `${playlist.name} is now your queue.` : 'Playlist not found.');
    } catch (error) {
      const savedPlaylists = await refreshOfflinePlaylists();
      const offlinePlaylist = findOfflinePlaylist(savedPlaylists, profile.url, playlistId);
      if (offlinePlaylist) {
        applyOfflinePlaylist(offlinePlaylist);
        setMessage(`${offlinePlaylist.playlistName} is available offline.`);
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
