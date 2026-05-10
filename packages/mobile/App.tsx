import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Linking,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  albumArtUrl,
  fetchAuthSession,
  loginWithPassword,
  normalizeServerUrl,
} from './src/api/oceanWaveClient';
import { brand } from './src/config/brand';
import { AddServerScreen } from './src/components/AddServerScreen';
import { PlaylistPlayerScreen } from './src/components/PlaylistPlayerScreen';
import { NavBar } from './src/components/NavBar';
import { ServerListScreen } from './src/components/ServerListScreen';
import {
  createProfile,
  DEMO_SERVER_URL,
  getBundlerServerUrl,
  ServerProfile,
} from './src/app/serverProfiles';
import { useTrackPlaybackControls } from './src/hooks/useTrackPlaybackControls';
import { useServerProfiles } from './src/hooks/useServerProfiles';
import { MobileScreen, usePlaylistLibrary } from './src/hooks/usePlaylistLibrary';
import { useOceanWaveDeepLinks } from './src/hooks/useOceanWaveDeepLinks';
import { findOfflinePlaylist, hasOfflinePlaylistUpdate } from './src/offline/offlinePlaylists';
import { isNetworkAvailable } from './src/storage/nativeKeyValue';


function OceanWaveMobileApp() {
  const {
    activeTrack,
    canControlPlayback,
    isPlaying,
    progressRatio,
    seekToTouch,
    setProgressWidth,
    skipNext,
    skipPrevious,
    togglePlayback,
  } = useTrackPlaybackControls();

  const [screen, setScreen] = useState<MobileScreen>('servers');
  const [serverName, setServerName] = useState('');
  const [serverUrl, setServerUrl] = useState(() => getBundlerServerUrl() || DEMO_SERVER_URL);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('Choose a server to start listening.');

  const {
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
  } = usePlaylistLibrary({ setIsLoading, setMessage, setScreen });

  const didAutoConnectLastProfileRef = useRef(false);

  const {
    deleteProfile,
    hasLoadedSavedProfiles,
    profiles,
    selectedProfile,
    selectedProfileId,
    setSelectedProfileId,
    upsertProfile,
  } = useServerProfiles({ onDeleteSelected: resetQueueState });

  const normalizedServerUrl = selectedProfile?.url ?? normalizeServerUrl(serverUrl);
  const activeTrackId = activeTrack?.id ? String(activeTrack.id) : undefined;
  const displayedActiveTrackId = pendingTrackId ?? activeTrackId ?? undefined;
  const displayedMiniTrack = pendingTrack
    ? {
      artist: pendingTrack.artist?.name ?? 'Unknown Artist',
      artwork: albumArtUrl(normalizedServerUrl, pendingTrack.album?.cover),
      title: pendingTrack.name,
    }
    : activeTrack;
  const selectedOfflinePlaylist = selectedPlaylistId
    ? findOfflinePlaylist(offlinePlaylists, normalizedServerUrl, selectedPlaylistId)
    : null;
  const isSelectedPlaylistOffline = Boolean(selectedOfflinePlaylist);
  const selectedPlaylistSummary = selectedPlaylistId
    ? playlists.find(playlist => playlist.id === selectedPlaylistId)
    : null;
  const hasSelectedPlaylistOfflineUpdate = hasOfflinePlaylistUpdate(selectedOfflinePlaylist, library)
    || Boolean(selectedOfflinePlaylist && selectedPlaylistSummary && selectedOfflinePlaylist.tracks.length < selectedPlaylistSummary.musicCount);
  const playlistOfflineStatuses = useMemo<Record<number, 'none' | 'partial' | 'downloaded'>>(() => {
    const statuses: Record<number, 'none' | 'partial' | 'downloaded'> = {};

    for (const playlist of playlists) {
      const offlinePlaylist = findOfflinePlaylist(offlinePlaylists, normalizedServerUrl, playlist.id);
      statuses[playlist.id] = !offlinePlaylist
        ? 'none'
        : offlinePlaylist.tracks.length >= playlist.musicCount ? 'downloaded' : 'partial';
    }

    return statuses;
  }, [normalizedServerUrl, offlinePlaylists, playlists]);

  useEffect(() => {
    if (pendingTrackId && activeTrackId === pendingTrackId) {
      clearPendingTrackId();
    }
  }, [activeTrackId, clearPendingTrackId, pendingTrackId]);

  useOceanWaveDeepLinks({
    normalizedServerUrl,
    profiles,
    setLibrary,
    setMessage,
    setPlaylists,
    setScreen,
    setSelectedPlaylistId,
    setSelectedPlaylistName,
    setSelectedProfileId,
    setServerName,
    setServerUrl,
    upsertProfile,
  });


  const handleMobileBack = useCallback(() => {
    if (screen === 'addServer') {
      setScreen('servers');
      return true;
    }

    if (screen === 'player') {
      if (searchQuery.trim()) {
        setSearchQuery('');
        return true;
      }


      setScreen('servers');
      return true;
    }

    return false;
  }, [screen, searchQuery, setSearchQuery]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', handleMobileBack);
    return () => subscription.remove();
  }, [handleMobileBack]);

  const connectProfile = useCallback(async (profile: ServerProfile) => {
    setIsLoading(true);
    setSelectedProfileId(profile.id);
    setMessage(`Opening ${profile.name}…`);

    const loadedCachedContent = await loadCachedServerContent(profile);
    if (loadedCachedContent) {
      setIsLoading(false);
      setMessage(`${profile.name} is available offline. Syncing server…`);
    }

    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) {
      setMessage(loadedCachedContent ? `${profile.name} is available offline.` : 'No network connection. Connect to the server network to sync.');
      setIsLoading(false);
      return;
    }

    try {
      const nextSession = await fetchAuthSession(profile.url, profile.sessionCookie);
      const nextProfile = await upsertProfile({ ...profile, authSession: nextSession });
      setSelectedProfileId(nextProfile.id);

      if (nextSession.authRequired && !nextSession.authenticated && !profile.sessionCookie) {
        if (loadedCachedContent) {
          setMessage(`${nextProfile.name} is available offline. Sign in to sync updates.`);
          return;
        }

        setServerName(nextProfile.name);
        setServerUrl(nextProfile.url);
        setPassword('');
        resetQueueState();
        setScreen('addServer');
        setMessage('Password required. Sign in once to save this server.');
        return;
      }

      await loadServerContent(nextProfile, { showLoading: !loadedCachedContent });
    } catch (error) {
      if (!loadedCachedContent) {
        setMessage(error instanceof Error ? error.message : String(error));
      } else {
        setMessage(`${profile.name} is available offline. Server sync failed.`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [loadCachedServerContent, loadServerContent, resetQueueState, setSelectedProfileId, upsertProfile]);

  useEffect(() => {
    if (!hasLoadedSavedProfiles || didAutoConnectLastProfileRef.current || screen !== 'servers') return;
    if (!selectedProfileId) return;

    const lastProfile = profiles.find(profile => profile.id === selectedProfileId);
    if (!lastProfile) return;

    didAutoConnectLastProfileRef.current = true;
    connectProfile(lastProfile).catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, [connectProfile, hasLoadedSavedProfiles, profiles, screen, selectedProfileId]);

  const saveServer = useCallback(async () => {
    const normalizedUrl = normalizeServerUrl(serverUrl);
    if (!normalizedUrl) {
      Alert.alert('Server URL required', `Example: ${getBundlerServerUrl() || DEMO_SERVER_URL}`);
      return;
    }

    setIsLoading(true);
    setMessage('Checking server…');
    try {
      const hasNetwork = await isNetworkAvailable();
      if (!hasNetwork) {
        setMessage('No network connection. Connect to the server network first.');
        return;
      }

      let nextProfile = createProfile(serverName, normalizedUrl, { id: selectedProfileId ?? undefined });
      const session = await fetchAuthSession(normalizedUrl, null);

      if (session.authRequired && !session.authenticated) {
        if (!password.trim()) {
          nextProfile = { ...nextProfile, authSession: session };
          await upsertProfile(nextProfile);
          setSelectedProfileId(nextProfile.id);
          setMessage('Password required.');
          return;
        }

        const result = await loginWithPassword(normalizedUrl, password);
        nextProfile = { ...nextProfile, sessionCookie: result.sessionCookie, authSession: result.session };
      } else {
        nextProfile = { ...nextProfile, authSession: session };
      }

      await upsertProfile(nextProfile);
      setSelectedProfileId(nextProfile.id);
      setPassword('');
      await loadServerContent(nextProfile);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [loadServerContent, password, selectedProfileId, serverName, serverUrl, setSelectedProfileId, upsertProfile]);

  const openAddServer = useCallback(() => {
    setSelectedProfileId(null);
    setServerName('');
    setServerUrl(getBundlerServerUrl() || DEMO_SERVER_URL);
    setPassword('');
    setScreen('addServer');
    setMessage('Add an Ocean Wave server.');
  }, [setSelectedProfileId]);

  const openWebApp = useCallback(async () => {
    if (!selectedProfile?.url) return;
    try {
      await Linking.openURL(selectedProfile.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [selectedProfile]);

  const openPlaylistCreator = useCallback(() => {
    if (!selectedProfile?.url) return;
    Alert.alert(
      'Open web app?',
      'Playlist creation opens in the web app.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open web', onPress: openWebApp },
      ],
    );
  }, [openWebApp, selectedProfile]);

  const handleOpenPlaylist = useCallback((playlistId: number) => openPlaylist(selectedProfile, playlistId), [openPlaylist, selectedProfile]);

  const handlePlayTrack = useCallback((index: number) => playTrack(selectedProfile, index), [playTrack, selectedProfile]);
  const handleToggleOffline = useCallback(() => {
    if (isSelectedPlaylistOffline && !hasSelectedPlaylistOfflineUpdate) {
      deleteSelectedOfflinePlaylist(selectedProfile).catch(error => setMessage(error instanceof Error ? error.message : String(error)));
      return;
    }

    saveSelectedPlaylistOffline(selectedProfile).catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, [deleteSelectedOfflinePlaylist, hasSelectedPlaylistOfflineUpdate, isSelectedPlaylistOffline, saveSelectedPlaylistOffline, selectedProfile]);

  const renderNavBar = (title: string) => <NavBar onBack={handleMobileBack} title={title} />;


  const renderServerList = () => (
    <ServerListScreen
      isLoading={isLoading}
      message={message}
      onAddServer={openAddServer}
      onConnect={profile => connectProfile(profile)}
      onDelete={deleteProfile}
      profiles={profiles}
    />
  );


  const renderAddServer = () => (
    <AddServerScreen
      header={renderNavBar('Add Server')}
      isLoading={isLoading}
      message={message}
      onChangePassword={setPassword}
      onChangeServerName={setServerName}
      onChangeServerUrl={setServerUrl}
      onSave={saveServer}
      password={password}
      serverName={serverName}
      serverUrl={serverUrl}
    />
  );

  const renderPlayer = () => (
    <PlaylistPlayerScreen
      activeTrack={activeTrack}
      displayedMiniTrack={displayedMiniTrack}
      canControlPlayback={canControlPlayback}
      displayedActiveTrackId={displayedActiveTrackId}
      isLoading={isLoading}
      isPlaying={isPlaying}
      isOfflineSaving={Boolean(offlineSaveProgress)}
      hasSelectedPlaylistOfflineUpdate={hasSelectedPlaylistOfflineUpdate}
      isSelectedPlaylistOffline={isSelectedPlaylistOffline}
      onBack={handleMobileBack}
      onCreatePlaylist={openPlaylistCreator}
      onNext={skipNext}
      onOpenPlaylist={handleOpenPlaylist}
      onPlayTrack={handlePlayTrack}
      onPrevious={skipPrevious}
      onProgressLayout={setProgressWidth}
      onSearchQueryChange={setSearchQuery}
      onSeek={seekToTouch}
      onTogglePlayback={togglePlayback}
      onToggleOffline={handleToggleOffline}
      offlineSaveProgress={offlineSaveProgress}
      playlistName={selectedPlaylistName}
      playlistOfflineStatuses={playlistOfflineStatuses}
      playlists={playlists}
      progressRatio={progressRatio}
      searchQuery={searchQuery}
      selectedPlaylistId={selectedPlaylistId}
      selectedProfileName={selectedProfile?.name}
      serverUrl={normalizedServerUrl}
      sessionCookie={selectedProfile?.sessionCookie}
      visibleLibrary={visibleLibrary}
    />
  );


  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={brand.background} />
      <View style={styles.container}>
        {screen === 'servers' ? renderServerList() : screen === 'addServer' ? renderAddServer() : renderPlayer()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: brand.background },
  container: { flex: 1, backgroundColor: brand.background },
});

function App() {
  return <OceanWaveMobileApp />;
}

export default App;
