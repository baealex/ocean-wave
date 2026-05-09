import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import {
  Alert,
  BackHandler,
  FlatList,
  Linking,
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
  OceanWaveMusic,
  OceanWavePlaylist,
} from './src/api/oceanWaveClient';
import { brand } from './src/config/brand';
import { AddServerScreen } from './src/components/AddServerScreen';
import { MiniPlayer } from './src/components/MiniPlayer';
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
import { formatDuration } from './src/utils/time';

type Screen = 'servers' | 'addServer' | 'player';

function getPlaybackStateValue(playbackState: ReturnType<typeof usePlaybackState>) {
  return 'state' in playbackState ? playbackState.state : playbackState;
}

function isSameTrack(item: OceanWaveMusic, activeTrackId?: string) {
  return activeTrackId === String(item.id);
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
      <MiniPlayer
        activeTrack={activeTrack}
        canControlPlayback={canControlPlayback}
        isPlaying={isPlaying}
        onNext={skipNext}
        onPrevious={skipPrevious}
        onProgressLayout={setProgressWidth}
        onSeek={seekToTouch}
        onTogglePlayback={togglePlayback}
        playlistName={selectedPlaylistName}
        progressRatio={progressRatio}
      />
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
  playerPage: { flex: 1, gap: 12, paddingHorizontal: 16, paddingTop: 4, backgroundColor: brand.background },
  kicker: { color: brand.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  playerHeader: { gap: 4, paddingHorizontal: 2 },
  playerHeading: { color: brand.text, fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  description: { color: brand.muted, fontSize: 15, lineHeight: 22 },
  disabledButton: { opacity: 0.42 },
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
});

function App() {
  return <OceanWaveMobileApp />;
}

export default App;
