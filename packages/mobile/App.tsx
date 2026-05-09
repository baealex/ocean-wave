import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import {
  Alert,
  BackHandler,
  Linking,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TrackPlayer, {
  State,
  useActiveTrack,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';
import {
  fetchAuthSession,
  fetchMobileMusic,
  fetchMobilePlaylist,
  fetchMobilePlaylists,
  loginWithPassword,
  normalizeServerUrl,
  OceanWaveMusic,
  OceanWavePlaylist,
} from './src/api/oceanWaveClient';
import { brand } from './src/config/brand';
import { AddServerScreen } from './src/components/AddServerScreen';
import { PlaylistPlayerScreen } from './src/components/PlaylistPlayerScreen';
import { NavBar } from './src/components/NavBar';
import { ServerListScreen } from './src/components/ServerListScreen';
import {
  createProfile,
  DEMO_SERVER_URL,
  getBuiltInProfiles,
  getBundlerServerUrl,
  LAST_PROFILE_ID_STORAGE_KEY,
  normalizeProfiles,
  readProfilesPayload,
  ServerProfile,
  SERVER_PROFILES_STORAGE_KEY,
} from './src/app/serverProfiles';
import { parseOceanWaveDeepLink, type OceanWaveDeepLinkRequest } from './src/deeplink/oceanWaveDeepLink';
import { getStoredString, setStoredString } from './src/storage/nativeKeyValue';
import { playLibraryFrom, prepareTrackPlayer } from './src/player/trackPlayer';

type Screen = 'servers' | 'addServer' | 'player';

function getPlaybackStateValue(playbackState: ReturnType<typeof usePlaybackState>) {
  return 'state' in playbackState ? playbackState.state : playbackState;
}


function OceanWaveMobileApp() {
  const playbackState = usePlaybackState();
  const playbackValue = getPlaybackStateValue(playbackState);
  const activeTrack = useActiveTrack();
  const progress = useProgress(500);
  const isPlaying = playbackValue === State.Playing;
  const canControlPlayback = Boolean(activeTrack);
  const [progressWidth, setProgressWidth] = useState(1);

  const [screen, setScreen] = useState<Screen>('servers');
  const [profiles, setProfiles] = useState<ServerProfile[]>(getBuiltInProfiles);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [serverName, setServerName] = useState('');
  const [serverUrl, setServerUrl] = useState(() => getBundlerServerUrl() || DEMO_SERVER_URL);
  const [password, setPassword] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [library, setLibrary] = useState<OceanWaveMusic[]>([]);
  const [playlists, setPlaylists] = useState<OceanWavePlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [selectedPlaylistName, setSelectedPlaylistName] = useState<string | null>(null);
  const [pendingDeepLink, setPendingDeepLink] = useState<OceanWaveDeepLinkRequest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedSavedProfiles, setHasLoadedSavedProfiles] = useState(false);
  const [message, setMessage] = useState('Choose a server to start listening.');
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);

  const handleDeepLinkUrlRef = useRef<(url: string | null) => void>(() => undefined);
  const didAutoConnectLastProfileRef = useRef(false);
  const selectedProfile = useMemo(() => profiles.find(profile => profile.id === selectedProfileId) ?? null, [profiles, selectedProfileId]);
  const normalizedServerUrl = selectedProfile?.url ?? normalizeServerUrl(serverUrl);
  const authSession = selectedProfile?.authSession ?? null;
  const isAuthenticated = authSession ? !authSession.authRequired || authSession.authenticated : false;
  const activeTrackId = activeTrack?.id ? String(activeTrack.id) : undefined;
  const displayedActiveTrackId = activeTrackId ?? pendingTrackId ?? undefined;
  const progressDuration = progress.duration || activeTrack?.duration || 0;
  const progressRatio = progressDuration > 0 ? Math.min(progress.position / progressDuration, 1) : 0;

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

  const persistProfiles = useCallback((nextProfiles: ServerProfile[]) => {
    setStoredString(SERVER_PROFILES_STORAGE_KEY, JSON.stringify(nextProfiles.filter(profile => !profile.isDemo))).catch(() => undefined);
  }, []);

  const persistLastProfileId = useCallback((profileId: string | null) => {
    if (!profileId) return;
    setStoredString(LAST_PROFILE_ID_STORAGE_KEY, profileId).catch(() => undefined);
  }, []);

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      getStoredString(SERVER_PROFILES_STORAGE_KEY),
      getStoredString(LAST_PROFILE_ID_STORAGE_KEY),
    ])
      .then(([profilesPayload, lastProfileId]) => {
        if (!isMounted) return;
        const nextProfiles = readProfilesPayload(profilesPayload);
        setProfiles(nextProfiles);
        if (lastProfileId && nextProfiles.some(profile => profile.id === lastProfileId)) {
          setSelectedProfileId(lastProfileId);
        }
        setHasLoadedSavedProfiles(true);
      })
      .catch(() => {
        if (!isMounted) return;
        setProfiles(getBuiltInProfiles());
        setHasLoadedSavedProfiles(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedSavedProfiles) return;
    persistProfiles(profiles);
  }, [hasLoadedSavedProfiles, persistProfiles, profiles]);

  const upsertProfile = useCallback(async (profile: ServerProfile) => {
    const normalizedProfile = { ...profile, url: normalizeServerUrl(profile.url) };
    setProfiles(currentProfiles => {
      const nextProfiles = normalizeProfiles(currentProfiles.some(item => item.id === normalizedProfile.id)
        ? currentProfiles.map(item => item.id === normalizedProfile.id ? normalizedProfile : item)
        : [normalizedProfile, ...currentProfiles]);
      persistProfiles(nextProfiles);
      persistLastProfileId(normalizedProfile.id);
      return nextProfiles;
    });
    return normalizedProfile;
  }, [persistLastProfileId, persistProfiles]);

  const resetQueueState = useCallback(() => {
    setLibrary([]);
    setPlaylists([]);
    setSelectedPlaylistId(null);
    setSelectedPlaylistName(null);
    setSearchQuery('');
  }, []);

  const deleteProfile = useCallback((profileId: string) => {
    setProfiles(currentProfiles => {
      const nextProfiles = normalizeProfiles(currentProfiles.filter(profile => profile.id !== profileId));
      persistProfiles(nextProfiles);
      return nextProfiles;
    });
    if (selectedProfileId === profileId) {
      setSelectedProfileId(null);
      resetQueueState();
    }
  }, [persistProfiles, resetQueueState, selectedProfileId]);

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
  }, [selectedPlaylistId]);

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
  }, [screen, searchQuery]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', handleMobileBack);
    return () => subscription.remove();
  }, [handleMobileBack]);

  const connectProfile = useCallback(async (profile: ServerProfile) => {
    setIsLoading(true);
    setSelectedProfileId(profile.id);
    persistLastProfileId(profile.id);
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
  }, [loadServerContent, persistLastProfileId, resetQueueState, upsertProfile]);

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
  }, [loadServerContent, password, selectedProfileId, serverName, serverUrl, upsertProfile]);

  const openAddServer = useCallback(() => {
    setSelectedProfileId(null);
    setServerName('');
    setServerUrl(getBundlerServerUrl() || DEMO_SERVER_URL);
    setPassword('');
    setScreen('addServer');
    setMessage('Add an Ocean Wave server.');
  }, []);

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

  const openPlaylist = useCallback(async (playlistId: number) => {
    if (!selectedProfile || !isAuthenticated) return;

    setIsLoading(true);
    try {
      const playlist = await fetchMobilePlaylist(selectedProfile.url, playlistId, selectedProfile.sessionCookie);
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
  }, [isAuthenticated, selectedProfile]);

  const playTrack = useCallback(async (index: number) => {
    if (!selectedProfile || !visibleLibrary.length) return;
    const selectedMusic = visibleLibrary[index];
    if (!selectedMusic) return;
    setPendingTrackId(String(selectedMusic.id));
    setMessage(`Starting ${selectedMusic.name}…`);
    try {
      await playLibraryFrom(selectedProfile.url, visibleLibrary, index, selectedProfile.sessionCookie);
      setMessage(`Playing ${selectedMusic.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingTrackId(null);
    }
  }, [selectedProfile, visibleLibrary]);

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
  }, [normalizedServerUrl, profiles, upsertProfile]);

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

  const togglePlayback = useCallback(async () => {
    if (!canControlPlayback) return;
    if (isPlaying) {
      await TrackPlayer.pause();
      return;
    }
    await TrackPlayer.play();
  }, [canControlPlayback, isPlaying]);

  const skipPrevious = useCallback(async () => {
    if (!canControlPlayback) return;
    await TrackPlayer.skipToPrevious().catch(() => TrackPlayer.seekTo(0));
  }, [canControlPlayback]);

  const skipNext = useCallback(async () => {
    if (!canControlPlayback) return;
    await TrackPlayer.skipToNext().catch(() => undefined);
  }, [canControlPlayback]);

  const seekToTouch = useCallback(async (event: GestureResponderEvent) => {
    if (!canControlPlayback || !progressDuration) return;
    const ratio = Math.max(0, Math.min(event.nativeEvent.locationX / progressWidth, 1));
    await TrackPlayer.seekTo(ratio * progressDuration);
  }, [canControlPlayback, progressDuration, progressWidth]);


  const playSelectedPlaylist = useCallback(() => {
    if (!visibleLibrary.length) return;
    playTrack(0).catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, [playTrack, visibleLibrary.length]);

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
      onOpenPlaylist={openPlaylist}
      onPlayPlaylist={playSelectedPlaylist}
      onPlayTrack={playTrack}
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
