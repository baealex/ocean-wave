import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  GestureResponderEvent,
  Linking,
  NativeModules,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
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
  OceanWaveAuthSession,
  OceanWaveMusic,
  OceanWavePlaylist,
} from './src/api/oceanWaveClient';
import { brand } from './src/config/brand';
import { parseOceanWaveDeepLink, type OceanWaveDeepLinkRequest } from './src/deeplink/oceanWaveDeepLink';
import { getStoredString, setStoredString } from './src/storage/nativeKeyValue';
import { playLibraryFrom, prepareTrackPlayer } from './src/player/trackPlayer';

const DEFAULT_SERVER_PORT = '44100';
const DEMO_SERVER_URL = 'https://demo-ocean-wave.baejino.com';
const SERVER_PROFILES_STORAGE_KEY = 'ocean-wave.serverProfiles.v1';
const LAST_PROFILE_ID_STORAGE_KEY = 'ocean-wave.lastProfileId.v1';

type Screen = 'servers' | 'addServer' | 'player';

type ServerProfile = {
  id: string;
  name: string;
  url: string;
  sessionCookie?: string | null;
  authSession?: OceanWaveAuthSession | null;
  isDemo?: boolean;
};

function formatDuration(duration?: number | null) {
  if (!duration) return '--:--';
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function getPlaybackStateValue(playbackState: ReturnType<typeof usePlaybackState>) {
  return 'state' in playbackState ? playbackState.state : playbackState;
}

function isSameTrack(item: OceanWaveMusic, activeTrackId?: string) {
  return activeTrackId === String(item.id);
}

function getBundlerServerUrl() {
  const scriptUrl = NativeModules.SourceCode?.scriptURL;
  if (typeof scriptUrl !== 'string') return '';

  const host = scriptUrl.match(/^[a-z]+:\/\/([^:/]+)/i)?.[1];
  return host ? `http://${host}:${DEFAULT_SERVER_PORT}` : '';
}

function createProfile(name: string, url: string, partial: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: partial.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: name.trim() || 'Ocean Wave Server',
    url: normalizeServerUrl(url),
    sessionCookie: partial.sessionCookie ?? null,
    authSession: partial.authSession ?? null,
    isDemo: partial.isDemo,
  };
}

function getBuiltInProfiles() {
  const localDemoUrl = getBundlerServerUrl();
  const profiles = [createProfile('Demo Ocean Wave', DEMO_SERVER_URL, { id: 'demo-ocean-wave', isDemo: true })];
  if (localDemoUrl && localDemoUrl !== DEMO_SERVER_URL) {
    profiles.push(createProfile('Local Demo', localDemoUrl, { id: 'local-demo', isDemo: true }));
  }
  return profiles;
}

function normalizeProfiles(profiles: ServerProfile[]) {
  const builtIns = getBuiltInProfiles();
  const byId = new Map<string, ServerProfile>();

  for (const profile of builtIns) {
    byId.set(profile.id, profile);
  }

  for (const profile of profiles) {
    if (!profile?.id || !profile.url) continue;
    if (profile.isDemo) continue;
    byId.set(profile.id, {
      id: profile.id,
      name: profile.name?.trim() || 'Ocean Wave Server',
      url: normalizeServerUrl(profile.url),
      sessionCookie: profile.sessionCookie ?? null,
      authSession: profile.authSession ?? null,
      isDemo: false,
    });
  }

  return Array.from(byId.values());
}

function readProfilesPayload(payload: string | null) {
  if (!payload) return getBuiltInProfiles();

  try {
    const parsed = JSON.parse(payload) as ServerProfile[];
    return normalizeProfiles(Array.isArray(parsed) ? parsed : []);
  } catch {
    return getBuiltInProfiles();
  }
}

function getInitialProfiles() {
  return getBuiltInProfiles();
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
  const [profiles, setProfiles] = useState<ServerProfile[]>(getInitialProfiles);
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


  const renderBackIcon = () => (
    <View style={styles.backIconFrame}>
      <View style={styles.backIconStroke} />
    </View>
  );

  const renderWebAction = () => (
    <View style={styles.webActionPill}>
      <Text style={styles.webActionText}>Web</Text>
    </View>
  );

  const renderPlusIcon = () => (
    <View style={styles.plusIcon}>
      <View style={styles.plusHorizontal} />
      <View style={styles.plusVertical} />
    </View>
  );

  const renderTrashIcon = () => (
    <View style={styles.trashIcon}>
      <View style={styles.trashLid} />
      <View style={styles.trashCan} />
    </View>
  );

  const renderChevronIcon = () => (
    <View style={styles.chevronIcon}>
      <View style={styles.chevronStroke} />
    </View>
  );

  const playSelectedPlaylist = useCallback(() => {
    if (!visibleLibrary.length) return;
    playTrack(0).catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, [playTrack, visibleLibrary.length]);

  const renderNavBar = (title: string, rightAction?: { label: string; onPress: () => void }) => (
    <View style={styles.navBar}>
      <Pressable accessibilityLabel="Go back" hitSlop={8} onPress={handleMobileBack} style={styles.navIconButton}>
        {renderBackIcon()}
      </Pressable>
      <Text numberOfLines={1} style={styles.navTitle}>{title}</Text>
      {rightAction ? (
        <Pressable accessibilityLabel={rightAction.label} hitSlop={8} onPress={rightAction.onPress} style={styles.navIconButton}>
          {renderWebAction()}
        </Pressable>
      ) : (
        <View style={styles.navIconButton} />
      )}
    </View>
  );

  const renderMiniPlayer = () => (
    <View style={styles.miniPlayer}>
      <Pressable
        disabled={!canControlPlayback}
        onLayout={event => setProgressWidth(Math.max(event.nativeEvent.layout.width, 1))}
        onPress={seekToTouch}
        style={styles.miniProgress}
      >
        <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
      </Pressable>
      <View style={styles.miniPlayerRow}>
        <View style={styles.miniMeta}>
          <Text numberOfLines={1} style={styles.miniTitle}>{activeTrack?.title ?? 'No track selected'}</Text>
          <Text numberOfLines={1} style={styles.miniSubtitle}>{activeTrack ? `${activeTrack.artist ?? 'Unknown Artist'} · ${selectedPlaylistName ?? 'Playlist'}` : (selectedPlaylistName ? 'Tap Play playlist or choose a track' : 'Choose a playlist')}</Text>
        </View>
        <Pressable accessibilityLabel="Previous track" disabled={!canControlPlayback} onPress={skipPrevious} style={[styles.iconButton, !canControlPlayback && styles.disabledButton]}>
          <Text style={styles.transportIconText}>⏮</Text>
        </Pressable>
        <Pressable accessibilityLabel={isPlaying ? 'Pause' : 'Play'} disabled={!canControlPlayback} onPress={togglePlayback} style={[styles.playCircle, !canControlPlayback && styles.disabledButton]}>
          <Text style={styles.playIconText}>{isPlaying ? 'Ⅱ' : '▶'}</Text>
        </Pressable>
        <Pressable accessibilityLabel="Next track" disabled={!canControlPlayback} onPress={skipNext} style={[styles.iconButton, !canControlPlayback && styles.disabledButton]}>
          <Text style={styles.transportIconText}>⏭</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderServerList = () => (
    <View style={styles.fullPage}>
      <View style={styles.header}>
        <Text style={styles.kicker}>OCEAN WAVE</Text>
        <Text style={styles.title}>Choose a server</Text>
        <Text style={styles.description}>Pick a saved server, try the local demo, or add your own library.</Text>
      </View>

      <View style={styles.serverList}>
        {profiles.map(profile => (
          <Pressable key={profile.id} disabled={isLoading} onPress={() => connectProfile(profile)} style={styles.serverCard}>
            <View style={styles.serverAvatar}><Text style={styles.serverAvatarText}>{profile.isDemo ? 'D' : profile.name.slice(0, 1).toUpperCase()}</Text></View>
            <View style={styles.serverCardText}>
              <Text numberOfLines={1} style={styles.serverTitle}>{profile.name}</Text>
              <Text numberOfLines={1} style={styles.serverUrl}>{profile.url}</Text>
            </View>
            {!profile.isDemo ? (
              <Pressable
                hitSlop={10}
                onPress={event => {
                  event.stopPropagation();
                  Alert.alert('Delete server?', profile.name, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deleteProfile(profile.id) },
                  ]);
                }}
                style={styles.deleteButton}
              >
                {renderTrashIcon()}
              </Pressable>
            ) : null}
            {renderChevronIcon()}
          </Pressable>
        ))}
        <Pressable disabled={isLoading} onPress={openAddServer} style={[styles.serverCard, styles.addServerCard]}>
          <View style={styles.addIcon}>{renderPlusIcon()}</View>
          <View style={styles.serverCardText}>
            <Text style={styles.serverTitle}>Add server</Text>
            <Text style={styles.serverUrl}>Save a personal Ocean Wave server.</Text>
          </View>
        </Pressable>
      </View>
      {isLoading ? <ActivityIndicator color={brand.primary} /> : null}
      <Text style={styles.status}>{message}</Text>
    </View>
  );

  const renderAddServer = () => (
    <View style={styles.fullPage}>
      {renderNavBar('Add Server')}
      <View style={styles.header}>
        <Text style={styles.kicker}>SERVER</Text>
        <Text style={styles.title}>Add your library</Text>
        <Text style={styles.description}>Connect once. If the server needs a password, this app saves the authenticated session.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Name</Text>
        <TextInput onChangeText={setServerName} placeholder="My Ocean Wave" placeholderTextColor="#71717a" style={styles.input} value={serverName} />
        <Text style={styles.label}>Server URL</Text>
        <TextInput autoCapitalize="none" autoCorrect={false} inputMode="url" onChangeText={setServerUrl} placeholder="http://192.168.0.10:44100" placeholderTextColor="#71717a" style={styles.input} value={serverUrl} />
        <Text style={styles.label}>Password</Text>
        <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setPassword} placeholder="Only if required" placeholderTextColor="#71717a" secureTextEntry style={styles.input} value={password} />
        <Pressable disabled={isLoading} onPress={saveServer} style={styles.wideButton}>
          {isLoading ? <ActivityIndicator color={brand.background} /> : <Text style={styles.wideButtonText}>Save and connect</Text>}
        </Pressable>
        <Text style={styles.status}>{message}</Text>
      </View>
    </View>
  );

  const renderPlayer = () => (
    <View style={styles.playerPage}>
      {renderNavBar(selectedProfile?.name ?? 'Ocean Wave')}

      <View style={styles.playerHeader}>
        <Text style={styles.kicker}>{selectedPlaylistName ? 'PLAYLIST' : 'PLAYLISTS'}</Text>
        <Text style={styles.playerHeading}>{selectedPlaylistName ?? 'Choose a playlist'}</Text>
        <Text style={styles.description}>{queueLabel}</Text>
      </View>


      {playlists.length ? (
        <View style={styles.playlistPanel}>
          <View style={styles.sectionHeader}>
            <Text style={styles.panelLabel}>{selectedPlaylistName ? 'Switch queue' : 'Choose queue'}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.playlistRail}>
            <Pressable disabled={!selectedProfile} onPress={openPlaylistCreator} style={[styles.playlistChip, styles.addPlaylistChip]}>
              <View style={styles.addPlaylistIcon}>
                <View style={styles.addPlaylistHorizontal} />
                <View style={styles.addPlaylistVertical} />
              </View>
              <Text style={styles.playlistName}>New playlist</Text>
              <Text style={styles.playlistMeta}>Opens web</Text>
            </Pressable>
            {playlists.map(playlist => (
              <Pressable key={playlist.id} disabled={isLoading} onPress={() => openPlaylist(playlist.id)} style={[styles.playlistChip, selectedPlaylistId === playlist.id && styles.playlistChipActive]}>
                <Text numberOfLines={1} style={styles.playlistName}>{playlist.name}</Text>
                <Text style={styles.playlistMeta}>{playlist.musicCount.toLocaleString()} tracks</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {selectedPlaylistName ? (
        <>
          <View style={styles.playlistActionPanel}>
            <Pressable disabled={!library.length} onPress={playSelectedPlaylist} style={[styles.playPlaylistButton, !library.length && styles.disabledButton]}>
              <Text style={styles.playPlaylistIcon}>▶</Text>
              <View style={styles.playPlaylistTextBlock}>
                <Text style={styles.playPlaylistTitle}>Play playlist</Text>
                <Text style={styles.playPlaylistSubtitle}>Starts from the first track and continues in order</Text>
              </View>
            </Pressable>
            <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setSearchQuery} placeholder="Search in playlist" placeholderTextColor="#71717a" style={styles.searchInput} value={searchQuery} />
          </View>

          <FlatList
            data={visibleLibrary}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading…' : 'No songs in this playlist.'}</Text>}
            renderItem={({ item, index }) => {
              const active = isSameTrack(item, displayedActiveTrackId);
              return (
                <Pressable onPress={() => playTrack(index)} style={[styles.row, active && styles.activeRow]}>
                  <View style={[styles.queueNumber, active && styles.queueNumberActive]}>
                    <Text style={[styles.queueNumberText, active && styles.queueNumberTextActive]}>{active ? '♪' : index + 1}</Text>
                  </View>
                  <View style={styles.rowMain}>
                    <View style={styles.songTitleRow}>
                      <Text numberOfLines={1} style={[styles.songTitle, active && styles.activeText]}>{item.name}</Text>
                      {active ? <Text style={styles.nowBadge}>NOW</Text> : null}
                    </View>
                    <Text numberOfLines={1} style={styles.songMeta}>{item.artist?.name ?? 'Unknown Artist'} · {item.album?.name ?? 'Unknown Album'}</Text>
                  </View>
                  <Text style={styles.duration}>{formatDuration(item.duration)}</Text>
                </Pressable>
              );
            }}
          />
        </>
      ) : (
        <View style={styles.emptyPlaylistState}>
          <Text style={styles.emptyPlaylistTitle}>Choose a playlist</Text>
          <Text style={styles.emptyPlaylistBody}>Create a playlist on the web, then come back here to play it.</Text>
          <Pressable disabled={!selectedProfile} onPress={openPlaylistCreator} style={styles.emptyPlaylistButton}>
            <Text style={styles.emptyPlaylistButtonText}>Open web</Text>
          </Pressable>
        </View>
      )}
      {renderMiniPlayer()}
    </View>
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
  fullPage: { flex: 1, gap: 18, padding: 20, backgroundColor: brand.background },
  playerPage: { flex: 1, gap: 12, paddingHorizontal: 16, paddingTop: 4, backgroundColor: brand.background },
  header: { gap: 8, paddingTop: 10 },
  kicker: { color: brand.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: brand.text, fontSize: 32, fontWeight: '900', letterSpacing: -1.4 },
  description: { color: brand.muted, fontSize: 15, lineHeight: 22 },
  serverList: { gap: 10 },
  serverCard: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 74, padding: 14, borderRadius: 20, backgroundColor: brand.surfaceRaised, borderWidth: 1, borderColor: brand.border },
  addServerCard: { borderStyle: 'dashed', backgroundColor: brand.surface },
  serverAvatar: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(139,92,246,0.16)' },
  serverAvatarText: { color: brand.primary, fontSize: 16, fontWeight: '900' },
  addIcon: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 14, backgroundColor: brand.primary },
  plusIcon: { alignItems: 'center', justifyContent: 'center', width: 20, height: 20 },
  plusHorizontal: { position: 'absolute', width: 18, height: 3, borderRadius: 999, backgroundColor: brand.background },
  plusVertical: { position: 'absolute', width: 3, height: 18, borderRadius: 999, backgroundColor: brand.background },
  serverCardText: { flex: 1, minWidth: 0, gap: 3 },
  serverTitle: { color: brand.text, fontSize: 16, fontWeight: '800' },
  serverUrl: { color: brand.muted, fontSize: 12 },
  deleteButton: { alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 20, backgroundColor: '#27272a' },
  trashIcon: { alignItems: 'center', width: 18, height: 20 },
  trashLid: { width: 14, height: 3, borderRadius: 2, backgroundColor: brand.muted },
  trashCan: { marginTop: 2, width: 13, height: 14, borderWidth: 2, borderTopWidth: 0, borderColor: brand.muted, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  chevronIcon: { alignItems: 'center', justifyContent: 'center', width: 24, height: 40 },
  chevronStroke: { width: 10, height: 10, borderTopWidth: 2, borderRightWidth: 2, borderColor: brand.muted, transform: [{ rotate: '45deg' }] },
  navBar: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 0, paddingTop: 4, paddingBottom: 4 },
  navIconButton: { alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 24 },
  backIconFrame: { alignItems: 'center', justifyContent: 'center', width: 28, height: 28 },
  backIconStroke: { width: 13, height: 13, borderLeftWidth: 2.5, borderBottomWidth: 2.5, borderColor: brand.text, transform: [{ rotate: '45deg' }] },
  webActionPill: { alignItems: 'center', justifyContent: 'center', minWidth: 44, height: 32, borderRadius: 999, backgroundColor: 'rgba(139,92,246,0.14)' },
  webActionText: { color: brand.primary, fontSize: 13, fontWeight: '900' },
  navTitle: { flex: 1, textAlign: 'center', color: brand.text, fontSize: 17, fontWeight: '800', paddingHorizontal: 8 },
  playerHeader: { gap: 4, paddingHorizontal: 2 },
  playerHeading: { color: brand.text, fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  card: { gap: 12, padding: 14, borderRadius: 22, backgroundColor: brand.surface, borderWidth: 1, borderColor: brand.border },
  label: { color: brand.text, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 48, borderRadius: 14, paddingHorizontal: 14, color: brand.text, backgroundColor: '#111113', borderWidth: 1, borderColor: brand.border, fontSize: 15 },
  wideButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: brand.primary },
  wideButtonText: { color: brand.background, fontSize: 14, fontWeight: '900' },
  disabledButton: { opacity: 0.42 },
  status: { color: brand.muted, fontSize: 13, lineHeight: 19 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playlistPanel: { gap: 8 },
  panelLabel: { color: brand.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  linkText: { color: brand.primary, fontSize: 12, fontWeight: '800' },
  playlistRail: { gap: 8, paddingRight: 16 },
  playlistChip: { width: 150, gap: 5, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#121214', borderWidth: 1, borderColor: brand.border },
  playlistChipActive: { borderColor: 'rgba(139,92,246,0.75)', backgroundColor: 'rgba(139,92,246,0.14)' },
  addPlaylistChip: { alignItems: 'flex-start', justifyContent: 'center', borderStyle: 'dashed', backgroundColor: '#09090b' },
  addPlaylistIcon: { alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 10, backgroundColor: 'rgba(139,92,246,0.16)' },
  addPlaylistHorizontal: { position: 'absolute', width: 14, height: 2.5, borderRadius: 999, backgroundColor: brand.primary },
  addPlaylistVertical: { position: 'absolute', width: 2.5, height: 14, borderRadius: 999, backgroundColor: brand.primary },
  playlistName: { color: brand.text, fontSize: 13, fontWeight: '800' },
  playlistMeta: { color: brand.muted, fontSize: 11 },
  queueStatementCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, backgroundColor: 'rgba(139,92,246,0.11)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.34)' },
  queueStatementIcon: { alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: 14, backgroundColor: brand.primary },
  queueStatementIconText: { color: brand.background, fontSize: 16, fontWeight: '900' },
  queueStatementText: { flex: 1, minWidth: 0, gap: 3 },
  queueStatementTitle: { color: brand.text, fontSize: 15, fontWeight: '900' },
  queueStatementBody: { color: brand.muted, fontSize: 12, lineHeight: 18 },
  emptyPlaylistState: { gap: 10, padding: 16, borderRadius: 20, backgroundColor: '#121214', borderWidth: 1, borderColor: brand.border },
  emptyPlaylistTitle: { color: brand.text, fontSize: 16, fontWeight: '900' },
  emptyPlaylistBody: { color: brand.muted, fontSize: 13, lineHeight: 20 },
  emptyPlaylistButton: { alignSelf: 'flex-start', minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingHorizontal: 14, backgroundColor: 'rgba(139,92,246,0.16)' },
  emptyPlaylistButtonText: { color: brand.primary, fontSize: 12, fontWeight: '900' },
  playlistActionPanel: { gap: 10 },
  playPlaylistButton: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14, borderRadius: 18, backgroundColor: brand.primary },
  playPlaylistIcon: { color: brand.background, fontSize: 18, fontWeight: '900' },
  playPlaylistTextBlock: { flex: 1, minWidth: 0, gap: 2 },
  playPlaylistTitle: { color: brand.background, fontSize: 15, fontWeight: '900' },
  playPlaylistSubtitle: { color: 'rgba(9,9,11,0.72)', fontSize: 12, fontWeight: '700' },
  browsePanel: { gap: 10 },
  searchInput: { minHeight: 42, borderRadius: 14, paddingHorizontal: 14, color: brand.text, backgroundColor: '#09090b', borderWidth: 1, borderColor: brand.border },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: { minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingHorizontal: 13, backgroundColor: '#18181b' },
  filterChipActive: { backgroundColor: brand.primary },
  refreshChip: { marginLeft: 'auto', minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingHorizontal: 13, backgroundColor: '#18181b' },
  filterText: { color: brand.muted, fontSize: 12, fontWeight: '800' },
  filterTextActive: { color: brand.background },
  queueHintBar: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#111113', borderWidth: 1, borderColor: brand.border },
  queueHintStrong: { color: brand.text, fontSize: 12, fontWeight: '900' },
  queueHintText: { flex: 1, color: brand.muted, fontSize: 11 },
  listContent: { gap: 8, paddingBottom: 108 },
  empty: { paddingVertical: 36, textAlign: 'center', color: brand.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#09090b', borderWidth: 1, borderColor: '#18181b' },
  activeRow: { borderColor: 'rgba(139,92,246,0.55)', backgroundColor: 'rgba(139,92,246,0.12)' },
  queueNumber: { alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12, backgroundColor: '#18181b' },
  queueNumberActive: { backgroundColor: brand.primary },
  queueNumberText: { color: brand.muted, fontSize: 13, fontWeight: '900' },
  queueNumberTextActive: { color: brand.background, fontSize: 16 },
  rowMain: { flex: 1, minWidth: 0, gap: 4 },
  songTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  songTitle: { flex: 1, color: brand.text, fontSize: 15, fontWeight: '700' },
  nowBadge: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, color: brand.background, backgroundColor: brand.primary, fontSize: 10, fontWeight: '900' },
  activeText: { color: brand.primary },
  songMeta: { color: brand.muted, fontSize: 12 },
  duration: { color: '#71717a', fontSize: 12, fontVariant: ['tabular-nums'] },
  miniPlayer: { position: 'absolute', left: 12, right: 12, bottom: 12, overflow: 'hidden', borderRadius: 22, backgroundColor: '#18181b', borderWidth: 1, borderColor: brand.border },
  miniProgress: { height: 8, justifyContent: 'center', backgroundColor: '#27272a' },
  progressFill: { height: 4, borderRadius: 999, backgroundColor: brand.primary },
  miniPlayerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 70, paddingHorizontal: 12 },
  miniMeta: { flex: 1, minWidth: 0, gap: 3 },
  miniTitle: { color: brand.text, fontSize: 15, fontWeight: '800' },
  miniSubtitle: { color: brand.muted, fontSize: 12 },
  iconButton: { alignItems: 'center', justifyContent: 'center', width: 48, height: 44, borderRadius: 999, backgroundColor: '#27272a' },
  transportIconText: { color: brand.text, fontSize: 20, fontWeight: '800', lineHeight: 22 },
  playCircle: { alignItems: 'center', justifyContent: 'center', width: 58, height: 46, borderRadius: 999, backgroundColor: brand.primary },
  playIconText: { color: brand.background, fontSize: 20, fontWeight: '900', lineHeight: 22 },
});

function App() {
  return <OceanWaveMobileApp />;
}

export default App;
