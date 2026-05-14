import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  fetchMobilePlaylist,
  fetchMobilePlaylists,
  OceanWaveMusic,
  OceanWavePlaylist,
} from '../api/oceanWaveClient';
import { mobileQueryKeys } from '../api/mobileQueryKeys';
import { ServerProfile } from '../app/serverProfiles';
import {
  deleteOfflinePlaylist,
  findOfflinePlaylist,
  listOfflinePlaylistsForServer,
  OfflinePlaylist,
  readCachedPlaylistDetail,
  readCachedPlaylistsForServer,
  readOfflinePlaylists,
  saveOfflinePlaylist,
  SaveOfflinePlaylistProgress,
  writeCachedPlaylistDetail,
  writeCachedPlaylistsForServer,
} from '../offline/offlinePlaylists';
import { playLibraryFrom, prepareTrackPlayer } from '../player/trackPlayer';
import { isNetworkAvailable } from '../storage/nativeKeyValue';

export type MobileScreen = 'servers' | 'addServer' | 'player';
export type MobileSyncStatus = 'idle' | 'offline' | 'syncing' | 'synced' | 'failed' | 'authRequired';
export type PlaylistContentState = 'idle' | 'showing-offline' | 'showing-cache' | 'skeleton' | 'refreshing' | 'synced' | 'failed';


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
  setSyncStatus: (value: MobileSyncStatus) => void;
};

export type CachedServerContentResult = {
  hasAnyContent: boolean;
  hasImmediateTrackContent: boolean;
  name?: string;
  source: 'cache' | 'none' | 'offline' | 'summary-only';
};

export function usePlaylistLibrary({ setIsLoading, setMessage, setScreen, setSyncStatus }: UsePlaylistLibraryOptions) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [library, setLibrary] = useState<OceanWaveMusic[]>([]);
  const [playlists, setPlaylists] = useState<OceanWavePlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [selectedPlaylistName, setSelectedPlaylistName] = useState<string | null>(null);
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  const [pendingTrack, setPendingTrack] = useState<OceanWaveMusic | null>(null);
  const [offlinePlaylists, setOfflinePlaylists] = useState<OfflinePlaylist[]>([]);
  const [offlineSaveProgress, setOfflineSaveProgress] = useState<SaveOfflinePlaylistProgress | null>(null);
  const [playlistContentState, setPlaylistContentState] = useState<PlaylistContentState>('idle');
  const playlistRequestSeqRef = useRef(0);

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
    setPlaylistContentState('idle');
    setSearchQuery('');
  }, []);

  const refreshOfflinePlaylists = useCallback(async () => {
    const nextOfflinePlaylists = await readOfflinePlaylists();
    setOfflinePlaylists(nextOfflinePlaylists);
    return nextOfflinePlaylists;
  }, []);

  const beginPlaylistRequest = useCallback(() => {
    playlistRequestSeqRef.current += 1;
    return playlistRequestSeqRef.current;
  }, []);

  const isPlaylistRequestCurrent = useCallback((requestSeq: number) => {
    return requestSeq === playlistRequestSeqRef.current;
  }, []);

  const fetchPlaylistSummaries = useCallback(async (profile: ServerProfile) => {
    return queryClient.fetchQuery({
      queryKey: mobileQueryKeys.playlists.list(profile.url, Boolean(profile.sessionCookie)),
      queryFn: async () => {
        const nextPlaylists = await fetchMobilePlaylists(profile.url, profile.sessionCookie);
        writeCachedPlaylistsForServer(profile.url, nextPlaylists).catch(() => undefined);
        return nextPlaylists;
      },
      staleTime: 0,
    });
  }, [queryClient]);

  const fetchPlaylistDetail = useCallback(async (profile: ServerProfile, playlistId: number) => {
    return queryClient.fetchQuery({
      queryKey: mobileQueryKeys.playlists.detail(profile.url, playlistId, Boolean(profile.sessionCookie)),
      queryFn: async () => {
        const playlist = await fetchMobilePlaylist(profile.url, playlistId, profile.sessionCookie);
        if (playlist) writeCachedPlaylistDetail(profile.url, playlist).catch(() => undefined);
        return playlist;
      },
      staleTime: 0,
    });
  }, [queryClient]);

  const applyOfflinePlaylist = useCallback((offlinePlaylist: OfflinePlaylist) => {
    setLibrary(offlinePlaylist.tracks);
    setSelectedPlaylistId(offlinePlaylist.playlistId);
    setSelectedPlaylistName(offlinePlaylist.playlistName);
    setPlaylistContentState('showing-offline');
    setSearchQuery('');
    setScreen('player');
  }, [setScreen]);

  const applyCachedPlaylistDetail = useCallback((cachedPlaylist: Awaited<ReturnType<typeof readCachedPlaylistDetail>>) => {
    if (!cachedPlaylist) return false;

    setLibrary(cachedPlaylist.tracks);
    setSelectedPlaylistId(cachedPlaylist.playlistId);
    setSelectedPlaylistName(cachedPlaylist.playlistName);
    setPlaylistContentState('showing-cache');
    setSearchQuery('');
    setScreen('player');
    return true;
  }, [setScreen]);


  const loadCachedServerContent = useCallback(async (profile: ServerProfile, options: { requestSeq?: number } = {}) => {
    const shouldApply = () => options.requestSeq === undefined || options.requestSeq === playlistRequestSeqRef.current;
    const [savedPlaylists, cachedPlaylists] = await Promise.all([
      refreshOfflinePlaylists(),
      readCachedPlaylistsForServer(profile.url),
    ]);
    if (!shouldApply()) return { hasAnyContent: false, hasImmediateTrackContent: false, source: 'none' } satisfies CachedServerContentResult;

    const offlineServerPlaylists = listOfflinePlaylistsForServer(savedPlaylists, profile.url);
    const playlistSummaries = mergePlaylistSummaries(cachedPlaylists, offlineServerPlaylists);
    const focusedPlaylist = playlistSummaries.find(playlist => playlist.id === selectedPlaylistId) ?? playlistSummaries[0];
    const offlineFallback = focusedPlaylist
      ? findOfflinePlaylist(savedPlaylists, profile.url, focusedPlaylist.id)
      : null;
    const cachedDetail = focusedPlaylist
      ? await readCachedPlaylistDetail(profile.url, focusedPlaylist.id)
      : null;
    if (!shouldApply()) return { hasAnyContent: false, hasImmediateTrackContent: false, source: 'none' } satisfies CachedServerContentResult;

    setPlaylists(playlistSummaries);
    setSearchQuery('');
    setScreen('player');
    prepareTrackPlayer().catch(() => undefined);

    if (offlineFallback) {
      if (!shouldApply()) return { hasAnyContent: false, hasImmediateTrackContent: false, source: 'none' } satisfies CachedServerContentResult;
      applyOfflinePlaylist(offlineFallback);
      setMessage(`${offlineFallback.playlistName} is available offline. Syncing server…`);
      return { hasAnyContent: true, hasImmediateTrackContent: true, name: offlineFallback.playlistName, source: 'offline' } satisfies CachedServerContentResult;
    }

    if (cachedDetail) {
      if (!shouldApply()) return { hasAnyContent: false, hasImmediateTrackContent: false, source: 'none' } satisfies CachedServerContentResult;
      applyCachedPlaylistDetail(cachedDetail);
      setMessage(`${cachedDetail.playlistName} is cached. Syncing server…`);
      return { hasAnyContent: true, hasImmediateTrackContent: true, name: cachedDetail.playlistName, source: 'cache' } satisfies CachedServerContentResult;
    }

    if (focusedPlaylist) {
      if (!shouldApply()) return { hasAnyContent: false, hasImmediateTrackContent: false, source: 'none' } satisfies CachedServerContentResult;
      setLibrary([]);
      setSelectedPlaylistId(focusedPlaylist.id);
      setSelectedPlaylistName(focusedPlaylist.name);
      setPlaylistContentState('skeleton');
      setMessage(`${focusedPlaylist.name} will load when the server responds.`);
      return { hasAnyContent: true, hasImmediateTrackContent: false, name: focusedPlaylist.name, source: 'summary-only' } satisfies CachedServerContentResult;
    }

    setLibrary([]);
    setSelectedPlaylistId(null);
    setSelectedPlaylistName(null);
    setPlaylistContentState('skeleton');
    setMessage('Syncing server…');
    return { hasAnyContent: false, hasImmediateTrackContent: false, source: 'none' } satisfies CachedServerContentResult;
  }, [applyCachedPlaylistDetail, applyOfflinePlaylist, refreshOfflinePlaylists, selectedPlaylistId, setMessage, setScreen]);

  const loadServerContent = useCallback(async (profile: ServerProfile, options: { requestSeq?: number; showLoading?: boolean } = {}) => {
    const { requestSeq = beginPlaylistRequest(), showLoading = true } = options;
    if (showLoading) setIsLoading(true);
    setSyncStatus('syncing');
    setMessage('Loading playlists…');
    setPendingTrack(null);
    setPendingTrackId(null);
    await refreshOfflinePlaylists();
    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) {
      await loadCachedServerContent(profile, { requestSeq });
      if (requestSeq !== playlistRequestSeqRef.current) return false;
      setSyncStatus('offline');
      setMessage('No network connection. Showing local content.');
      if (showLoading) setIsLoading(false);
      return false;
    }

    try {
      const nextPlaylists = await fetchPlaylistSummaries(profile);
      const focusedPlaylist = nextPlaylists.find(playlist => playlist.id === selectedPlaylistId) ?? nextPlaylists[0];
      if (requestSeq !== playlistRequestSeqRef.current) return false;

      setPlaylists(nextPlaylists);
      setSearchQuery('');
      setScreen('player');
      prepareTrackPlayer().catch(() => undefined);

      if (!focusedPlaylist) {
        setLibrary([]);
        setSelectedPlaylistId(null);
        setSelectedPlaylistName(null);
        setSyncStatus('synced');
        setMessage('No playlists yet. Create one in the web app first.');
        return true;
      }

      const cachedDetail = await readCachedPlaylistDetail(profile.url, focusedPlaylist.id);
      if (requestSeq !== playlistRequestSeqRef.current) return false;
      if (cachedDetail) {
        applyCachedPlaylistDetail(cachedDetail);
        setMessage(`${cachedDetail.playlistName} is cached. Syncing server…`);
      } else {
        setPlaylistContentState('skeleton');
      }

      const playlist = await fetchPlaylistDetail(profile, focusedPlaylist.id);
      if (requestSeq !== playlistRequestSeqRef.current) return false;
      const nextMusics = playlist?.musics ?? [];
      setLibrary(nextMusics);
      setSelectedPlaylistId(focusedPlaylist.id);
      setSelectedPlaylistName(playlist?.name ?? focusedPlaylist.name);
      setPlaylistContentState('synced');
      setSyncStatus('synced');
      setMessage(`${playlist?.name ?? focusedPlaylist.name} ready.`);
      return true;
    } catch (error) {
      if (requestSeq !== playlistRequestSeqRef.current) return false;
      const cachedContent = await loadCachedServerContent(profile, { requestSeq });
      if (requestSeq !== playlistRequestSeqRef.current) return false;
      setPlaylistContentState(cachedContent.hasImmediateTrackContent ? 'failed' : 'skeleton');
      setSyncStatus('failed');
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      if (showLoading && requestSeq === playlistRequestSeqRef.current) setIsLoading(false);
    }
  }, [applyCachedPlaylistDetail, beginPlaylistRequest, fetchPlaylistDetail, fetchPlaylistSummaries, loadCachedServerContent, refreshOfflinePlaylists, selectedPlaylistId, setIsLoading, setMessage, setScreen, setSyncStatus]);

  const openPlaylist = useCallback(async (profile: ServerProfile | null, playlistId: number) => {
    if (!profile) return;

    const requestSeq = beginPlaylistRequest();
    const pendingPlaylist = playlists.find(playlist => playlist.id === playlistId);
    const savedPlaylists = await refreshOfflinePlaylists();
    if (requestSeq !== playlistRequestSeqRef.current) return;

    const offlinePlaylist = findOfflinePlaylist(savedPlaylists, profile.url, playlistId);
    const cachedDetail = await readCachedPlaylistDetail(profile.url, playlistId);
    if (requestSeq !== playlistRequestSeqRef.current) return;
    const hasImmediateContent = Boolean(offlinePlaylist || cachedDetail);

    setIsLoading(!hasImmediateContent);
    setSelectedPlaylistId(playlistId);
    setSelectedPlaylistName(pendingPlaylist?.name ?? null);
    setPendingTrack(null);
    setPendingTrackId(null);
    if (offlinePlaylist) {
      applyOfflinePlaylist(offlinePlaylist);
      setMessage(`${offlinePlaylist.playlistName} is available offline. Syncing server…`);
    } else if (cachedDetail && applyCachedPlaylistDetail(cachedDetail)) {
      setMessage(`${cachedDetail.playlistName} is cached. Syncing server…`);
    } else {
      setLibrary([]);
      setPlaylistContentState('skeleton');
    }
    setSearchQuery('');
    const hasNetwork = await isNetworkAvailable();
    if (requestSeq !== playlistRequestSeqRef.current) return;

    if (!hasNetwork) {
      setSyncStatus('offline');
      setMessage(offlinePlaylist
        ? `${offlinePlaylist.playlistName} is available offline.`
        : cachedDetail ? `${cachedDetail.playlistName} is cached for offline viewing.`
          : 'No network connection. Connect to the server network to load this playlist.');
      setIsLoading(false);
      return;
    }

    try {
      if (hasImmediateContent) {
        setPlaylistContentState('refreshing');
      }
      const playlist = await fetchPlaylistDetail(profile, playlistId);
      if (requestSeq !== playlistRequestSeqRef.current) return;
      const nextMusics = playlist?.musics ?? [];
      setSelectedPlaylistId(playlist?.id ?? playlistId);
      setSelectedPlaylistName(playlist?.name ?? null);
      setLibrary(nextMusics);
      setPlaylistContentState('synced');
      setSyncStatus('synced');
      setMessage(playlist ? `${playlist.name} is now your queue.` : 'Playlist not found.');
    } catch (error) {
      if (requestSeq !== playlistRequestSeqRef.current) return;
      if (offlinePlaylist) {
        setPlaylistContentState('failed');
        setSyncStatus('failed');
        setMessage(`${offlinePlaylist.playlistName} is available offline. Server sync failed.`);
      } else if (cachedDetail) {
        setPlaylistContentState('failed');
        setSyncStatus('failed');
        setMessage(`${cachedDetail.playlistName} is cached. Server sync failed.`);
      } else {
        setPlaylistContentState('failed');
        setSyncStatus('failed');
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestSeq === playlistRequestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [applyCachedPlaylistDetail, applyOfflinePlaylist, beginPlaylistRequest, fetchPlaylistDetail, playlists, refreshOfflinePlaylists, setIsLoading, setMessage, setSyncStatus]);

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
    if (!profile || !selectedPlaylistId || !selectedPlaylistName) return;
    setMessage(`Downloading ${selectedPlaylistName} for offline playback…`);
    try {
      const hasNetwork = await isNetworkAvailable();
      if (!hasNetwork) {
        setSyncStatus('offline');
        setMessage('No network connection. Connect to the server network to download this playlist.');
        return;
      }

      const latestPlaylist = await fetchMobilePlaylist(profile.url, selectedPlaylistId, profile.sessionCookie);
      const sourceTracks = latestPlaylist?.musics ?? library;
      const sourceName = latestPlaylist?.name ?? selectedPlaylistName;
      if (!sourceTracks.length) {
        setMessage('No songs in this playlist to download.');
        return;
      }

      setLibrary(sourceTracks);
      setSelectedPlaylistName(sourceName);
      setOfflineSaveProgress({ completed: 0, failed: 0, playlistId: selectedPlaylistId, total: sourceTracks.length });

      const savedPlaylist = await saveOfflinePlaylist(profile, selectedPlaylistId, sourceName, sourceTracks, setOfflineSaveProgress);
      await refreshOfflinePlaylists();
      const failedCount = savedPlaylist.failedTracks?.length ?? 0;
      const downloadedCount = savedPlaylist.tracks.length;
      setMessage(failedCount
        ? `${sourceName} partially downloaded (${downloadedCount}/${sourceTracks.length}, ${failedCount} failed).`
        : `${sourceName} downloaded for offline playback.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setOfflineSaveProgress(null);
    }
  }, [library, refreshOfflinePlaylists, selectedPlaylistId, selectedPlaylistName, setMessage, setSyncStatus]);

  const deleteSelectedOfflinePlaylist = useCallback(async (profile: ServerProfile | null) => {
    if (!profile || !selectedPlaylistId) return;
    const nextOfflinePlaylists = await deleteOfflinePlaylist(profile.url, selectedPlaylistId);
    setOfflinePlaylists(nextOfflinePlaylists);
    setMessage('Downloaded playlist removed.');
  }, [selectedPlaylistId, setMessage]);

  return {
    library,
    beginPlaylistRequest,
    loadCachedServerContent,
    loadServerContent,
    isPlaylistRequestCurrent,
    openPlaylist,
    clearPendingTrackId,
    pendingTrackId,
    pendingTrack,
    deleteSelectedOfflinePlaylist,
    offlinePlaylists,
    offlineSaveProgress,
    playlistContentState,
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
