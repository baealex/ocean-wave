import { useCallback, useEffect, useRef, useState } from 'react';
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
  fetchAuthSession,
  fetchMobileMusic,
  fetchMobilePlaylist,
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
import { parseOceanWaveDeepLink, type OceanWaveDeepLinkRequest } from './src/deeplink/oceanWaveDeepLink';
import { playLibraryFrom } from './src/player/trackPlayer';
import { useTrackPlaybackControls } from './src/hooks/useTrackPlaybackControls';
import { useServerProfiles } from './src/hooks/useServerProfiles';
import { MobileScreen, usePlaylistLibrary } from './src/hooks/usePlaylistLibrary';


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
  const [pendingDeepLink, setPendingDeepLink] = useState<OceanWaveDeepLinkRequest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('Choose a server to start listening.');

  const {
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
  } = usePlaylistLibrary({ setIsLoading, setMessage, setScreen });

  const handleDeepLinkUrlRef = useRef<(url: string | null) => void>(() => undefined);
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
  const authSession = selectedProfile?.authSession ?? null;
  const isAuthenticated = authSession ? !authSession.authRequired || authSession.authenticated : false;
  const activeTrackId = activeTrack?.id ? String(activeTrack.id) : undefined;
  const displayedActiveTrackId = activeTrackId ?? pendingTrackId ?? undefined;



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
    setMessage(`Connecting to ${profile.name}…`);
    try {
      const nextSession = await fetchAuthSession(profile.url, profile.sessionCookie);
      const nextProfile = await upsertProfile({ ...profile, authSession: nextSession });
      setSelectedProfileId(nextProfile.id);

      if (nextSession.authRequired && !nextSession.authenticated) {
        setServerName(nextProfile.name);
        setServerUrl(nextProfile.url);
        setPassword('');
        resetQueueState();
        setScreen('addServer');
        setMessage('Password required. Sign in once to save this server.');
        return;
      }

      await loadServerContent(nextProfile);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [loadServerContent, resetQueueState, setSelectedProfileId, upsertProfile]);

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

  const handleOpenPlaylist = useCallback((playlistId: number) => openPlaylist(selectedProfile, isAuthenticated, playlistId), [isAuthenticated, openPlaylist, selectedProfile]);

  const handlePlayTrack = useCallback((index: number) => playTrack(selectedProfile, index), [playTrack, selectedProfile]);

  const runDeepLink = useCallback(async (request: OceanWaveDeepLinkRequest) => {
    setPendingDeepLink(null);
    const requestServerUrl = normalizeServerUrl(request.serverUrl ?? normalizedServerUrl);
    const profile = profiles.find(item => item.url === requestServerUrl) ?? createProfile('Shared Server', requestServerUrl);
    const savedProfile = await upsertProfile(profile);
    setSelectedProfileId(savedProfile.id);

    try {
      const session = await fetchAuthSession(savedProfile.url, savedProfile.sessionCookie);
      const authedProfile = await upsertProfile({ ...savedProfile, authSession: session });
      if (session.authRequired && !session.authenticated) {
        setServerName(authedProfile.name);
        setServerUrl(authedProfile.url);
        setScreen('addServer');
        setMessage('Password required for this shared server.');
        return;
      }

      if (request.target === 'music') {
        const music = await fetchMobileMusic(authedProfile.url, request.id, authedProfile.sessionCookie);
        if (!music) {
          setMessage('Requested track not found.');
          return;
        }
        setLibrary([music]);
        setPlaylists([]);
        setSelectedPlaylistId(null);
        setSelectedPlaylistName(null);
        setScreen('player');
        await playLibraryFrom(authedProfile.url, [music], 0, authedProfile.sessionCookie);
        setMessage(`${music.name} playback started.`);
        return;
      }

      const playlist = await fetchMobilePlaylist(authedProfile.url, request.id, authedProfile.sessionCookie);
      const nextMusics = playlist?.musics ?? [];
      if (!playlist || nextMusics.length === 0) {
        setMessage('Requested playlist was not found or is empty.');
        return;
      }

      setLibrary(nextMusics);
      setSelectedPlaylistId(playlist.id);
      setSelectedPlaylistName(playlist.name);
      setScreen('player');
      await playLibraryFrom(authedProfile.url, nextMusics, 0, authedProfile.sessionCookie);
      setMessage(`${playlist.name} playlist playback started.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [normalizedServerUrl, profiles, setLibrary, setPlaylists, setSelectedPlaylistId, setSelectedPlaylistName, setSelectedProfileId, upsertProfile]);

  const handleDeepLinkUrl = useCallback((url: string | null) => {
    if (!url) return;
    const request = parseOceanWaveDeepLink(url);
    if (!request) return;
    setPendingDeepLink(request);
  }, []);

  useEffect(() => {
    handleDeepLinkUrlRef.current = handleDeepLinkUrl;
  }, [handleDeepLinkUrl]);

  useEffect(() => {
    Linking.getInitialURL()
      .then(url => handleDeepLinkUrlRef.current(url))
      .catch(error => setMessage(error instanceof Error ? error.message : String(error)));

    const subscription = Linking.addEventListener('url', event => handleDeepLinkUrlRef.current(event.url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!pendingDeepLink) return;
    runDeepLink(pendingDeepLink).catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, [pendingDeepLink, runDeepLink]);

  const handlePlaySelectedPlaylist = useCallback(() => playSelectedPlaylist(selectedProfile), [playSelectedPlaylist, selectedProfile]);

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
      canControlPlayback={canControlPlayback}
      displayedActiveTrackId={displayedActiveTrackId}
      isLoading={isLoading}
      isPlaying={isPlaying}
      library={library}
      onBack={handleMobileBack}
      onCreatePlaylist={openPlaylistCreator}
      onNext={skipNext}
      onOpenPlaylist={handleOpenPlaylist}
      onPlayPlaylist={handlePlaySelectedPlaylist}
      onPlayTrack={handlePlayTrack}
      onPrevious={skipPrevious}
      onProgressLayout={setProgressWidth}
      onSearchQueryChange={setSearchQuery}
      onSeek={seekToTouch}
      onTogglePlayback={togglePlayback}
      playlistName={selectedPlaylistName}
      playlists={playlists}
      progressRatio={progressRatio}
      queueLabel={queueLabel}
      searchQuery={searchQuery}
      selectedPlaylistId={selectedPlaylistId}
      selectedProfileName={selectedProfile?.name}
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
