import { useCallback, useMemo, useState } from 'react';

import {
  fetchMobilePlaylist,
  fetchMobilePlaylists,
  OceanWaveMusic,
  OceanWavePlaylist,
} from '../api/oceanWaveClient';
import { ServerProfile } from '../app/serverProfiles';
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

  const visibleLibrary = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return library;

    return library.filter(item => [item.name, item.artist?.name, item.album?.name]
      .filter(Boolean)
      .some(value => value?.toLowerCase().includes(normalizedQuery)));
  }, [library, searchQuery]);

  const queueLabel = selectedPlaylistName
    ? (library.length ? `${library.length.toLocaleString()} tracks · plays in order` : 'This playlist is empty')
    : (playlists.length ? `${playlists.length.toLocaleString()} playlists available` : 'No playlists yet');

  const resetQueueState = useCallback(() => {
    setLibrary([]);
    setPlaylists([]);
    setSelectedPlaylistId(null);
    setSelectedPlaylistName(null);
    setSearchQuery('');
  }, []);

  const loadServerContent = useCallback(async (profile: ServerProfile) => {
    setIsLoading(true);
    setMessage('Loading playlists…');
    try {
      const nextPlaylists = await fetchMobilePlaylists(profile.url, profile.sessionCookie).catch(() => []);
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
        return;
      }

      const playlist = await fetchMobilePlaylist(profile.url, focusedPlaylist.id, profile.sessionCookie);
      const nextMusics = playlist?.musics ?? [];
      setLibrary(nextMusics);
      setSelectedPlaylistId(focusedPlaylist.id);
      setSelectedPlaylistName(playlist?.name ?? focusedPlaylist.name);
      setMessage(`${playlist?.name ?? focusedPlaylist.name} ready.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [selectedPlaylistId, setIsLoading, setMessage, setScreen]);

  const openPlaylist = useCallback(async (profile: ServerProfile | null, isAuthenticated: boolean, playlistId: number) => {
    if (!profile || !isAuthenticated) return;

    setIsLoading(true);
    try {
      const playlist = await fetchMobilePlaylist(profile.url, playlistId, profile.sessionCookie);
      const nextMusics = playlist?.musics ?? [];
      setSelectedPlaylistId(playlist?.id ?? playlistId);
      setSelectedPlaylistName(playlist?.name ?? null);
      setLibrary(nextMusics);
      setSearchQuery('');
      setMessage(playlist ? `${playlist.name} is now your queue.` : 'Playlist not found.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [setIsLoading, setMessage]);

  const playTrack = useCallback(async (profile: ServerProfile | null, index: number) => {
    if (!profile || !visibleLibrary.length) return;
    const selectedMusic = visibleLibrary[index];
    if (!selectedMusic) return;
    setPendingTrackId(String(selectedMusic.id));
    setMessage(`Starting ${selectedMusic.name}…`);
    try {
      await playLibraryFrom(profile.url, visibleLibrary, index, profile.sessionCookie);
      setMessage(`Playing ${selectedMusic.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingTrackId(null);
    }
  }, [setMessage, visibleLibrary]);

  const playSelectedPlaylist = useCallback((profile: ServerProfile | null) => {
    if (!visibleLibrary.length) return;
    playTrack(profile, 0).catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, [playTrack, setMessage, visibleLibrary.length]);

  return {
    library,
    loadServerContent,
    openPlaylist,
    pendingTrackId,
    playSelectedPlaylist,
    playTrack,
    playlists,
    queueLabel,
    resetQueueState,
    searchQuery,
    selectedPlaylistId,
    selectedPlaylistName,
    setLibrary,
    setPlaylists,
    setSearchQuery,
    setSelectedPlaylistId,
    setSelectedPlaylistName,
    visibleLibrary,
  };
}
