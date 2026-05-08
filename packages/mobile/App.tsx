import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  GestureResponderEvent,
  Linking,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import TrackPlayer, {
  State,
  useActiveTrack,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';

import {
  fetchAuthSession,
  fetchMobileLibrary,
  fetchMobileMusic,
  fetchMobilePlaylist,
  fetchMobilePlaylists,
  loginWithPassword,
  logoutSession,
  normalizeServerUrl,
  OceanWaveAuthSession,
  OceanWaveMusic,
  OceanWavePlaylist,
} from './src/api/oceanWaveClient';
import { brand } from './src/config/brand';
import { parseOceanWaveDeepLink, type OceanWaveDeepLinkRequest } from './src/deeplink/oceanWaveDeepLink';
import { playLibraryFrom, prepareTrackPlayer } from './src/player/trackPlayer';

const SEEK_STEP_SECONDS = 15;
type BrowseFilter = 'all' | 'favorites' | 'recent';

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

function App() {
  const playbackState = usePlaybackState();
  const playbackValue = getPlaybackStateValue(playbackState);
  const activeTrack = useActiveTrack();
  const progress = useProgress(500);
  const [progressWidth, setProgressWidth] = useState(1);
  const isPlaying = playbackValue === State.Playing;
  const canControlPlayback = Boolean(activeTrack);
  const [serverUrl, setServerUrl] = useState('');
  const [password, setPassword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [browseFilter, setBrowseFilter] = useState<BrowseFilter>('all');
  const [sessionCookie, setSessionCookie] = useState<string | null>(null);
  const [authSession, setAuthSession] = useState<OceanWaveAuthSession | null>(null);
  const [library, setLibrary] = useState<OceanWaveMusic[]>([]);
  const [playlists, setPlaylists] = useState<OceanWavePlaylist[]>([]);
  const [selectedPlaylistName, setSelectedPlaylistName] = useState<string | null>(null);
  const [pendingDeepLink, setPendingDeepLink] = useState<OceanWaveDeepLinkRequest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('서버 연결을 확인한 뒤 백그라운드 재생 테스트를 시작할 수 있어요.');

  const normalizedServerUrl = useMemo(() => normalizeServerUrl(serverUrl), [serverUrl]);
  const previousServerUrlRef = useRef<string | null>(null);
  const handleDeepLinkUrlRef = useRef<(url: string | null) => void>(() => undefined);
  const isAuthenticated = authSession ? !authSession.authRequired || authSession.authenticated : false;
  const activeTrackId = activeTrack?.id ? String(activeTrack.id) : undefined;
  const visibleLibrary = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filteredByMode = browseFilter === 'favorites'
      ? library.filter(item => item.isLiked)
      : browseFilter === 'recent'
        ? [...library].sort((first, second) => Number(new Date(second.createdAt ?? 0)) - Number(new Date(first.createdAt ?? 0))).slice(0, 50)
        : library;

    if (!normalizedQuery) return filteredByMode;

    return filteredByMode.filter(item => [item.name, item.artist?.name, item.album?.name]
      .filter(Boolean)
      .some(value => value?.toLowerCase().includes(normalizedQuery)));
  }, [browseFilter, library, searchQuery]);
  const queueLabel = library.length ? `${visibleLibrary.length.toLocaleString()} of ${library.length.toLocaleString()} tracks` : 'Build a queue from this server';
  const progressDuration = progress.duration || activeTrack?.duration || 0;
  const progressRatio = progressDuration > 0 ? Math.min(progress.position / progressDuration, 1) : 0;

  useEffect(() => {
    if (previousServerUrlRef.current === null) {
      previousServerUrlRef.current = normalizedServerUrl;
      return;
    }

    previousServerUrlRef.current = normalizedServerUrl;
    setAuthSession(null);
    setSessionCookie(null);
    setLibrary([]);
    setPlaylists([]);
    setSelectedPlaylistName(null);
    setSearchQuery('');
    setBrowseFilter('all');
    TrackPlayer.reset().catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, [normalizedServerUrl]);

  useEffect(() => {
    prepareTrackPlayer().catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  const requireServerUrl = useCallback(() => {
    if (normalizedServerUrl) return true;
    Alert.alert('서버 주소 필요', '예: http://192.168.0.10:3000');
    return false;
  }, [normalizedServerUrl]);

  const checkSession = useCallback(async () => {
    if (!requireServerUrl()) return;

    setIsLoading(true);
    try {
      const nextSession = await fetchAuthSession(normalizedServerUrl, sessionCookie);
      setAuthSession(nextSession);
      setMessage(nextSession.authRequired
        ? nextSession.authenticated
          ? '인증된 서버 세션입니다.'
          : '비밀번호 인증이 필요한 서버입니다.'
        : '인증 없이 사용할 수 있는 서버입니다.');
    } catch (error) {
      setAuthSession(null);
      setSessionCookie(null);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [normalizedServerUrl, requireServerUrl, sessionCookie]);

  const login = useCallback(async () => {
    if (!requireServerUrl()) return;
    if (!password.trim()) {
      Alert.alert('비밀번호 필요', '서버 비밀번호를 입력해 주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await loginWithPassword(normalizedServerUrl, password);
      setAuthSession(result.session);
      setSessionCookie(result.sessionCookie);
      setPassword('');
      setMessage('로그인 완료. 이제 라이브러리를 불러올 수 있어요.');
    } catch (error) {
      setSessionCookie(null);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [normalizedServerUrl, password, requireServerUrl]);

  const logout = useCallback(async () => {
    if (!requireServerUrl()) return;

    setIsLoading(true);
    try {
      const nextSession = await logoutSession(normalizedServerUrl, sessionCookie);
      setAuthSession(nextSession);
      setSessionCookie(null);
      setLibrary([]);
      setPlaylists([]);
      setSelectedPlaylistName(null);
      setSearchQuery('');
      setBrowseFilter('all');
      await TrackPlayer.reset();
      setMessage('로그아웃 완료. 모바일 세션을 비웠어요.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [normalizedServerUrl, requireServerUrl, sessionCookie]);

  const openWebApp = useCallback(async () => {
    if (!requireServerUrl()) return;

    try {
      await Linking.openURL(normalizedServerUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [normalizedServerUrl, requireServerUrl]);

  const loadLibrary = useCallback(async () => {
    if (!requireServerUrl()) return;
    if (!isAuthenticated) {
      Alert.alert('인증 필요', '먼저 서버 연결 상태를 확인하고 로그인해 주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const nextLibrary = await fetchMobileLibrary(normalizedServerUrl, sessionCookie);
      setSelectedPlaylistName(null);
      setLibrary(nextLibrary);
      setMessage(`${nextLibrary.length.toLocaleString()}곡을 불러왔어요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, normalizedServerUrl, requireServerUrl, sessionCookie]);

  const loadPlaylists = useCallback(async () => {
    if (!requireServerUrl()) return;
    if (!isAuthenticated) {
      Alert.alert('인증 필요', '먼저 서버 연결 상태를 확인하고 로그인해 주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const nextPlaylists = await fetchMobilePlaylists(normalizedServerUrl, sessionCookie);
      setPlaylists(nextPlaylists);
      setMessage(`${nextPlaylists.length.toLocaleString()}개 플레이리스트를 불러왔어요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, normalizedServerUrl, requireServerUrl, sessionCookie]);

  const openPlaylist = useCallback(async (playlistId: number) => {
    if (!requireServerUrl()) return;
    if (!isAuthenticated) return;

    setIsLoading(true);
    try {
      const playlist = await fetchMobilePlaylist(normalizedServerUrl, playlistId, sessionCookie);
      const nextMusics = playlist?.musics ?? [];
      setSelectedPlaylistName(playlist?.name ?? null);
      setLibrary(nextMusics);
      setSearchQuery('');
      setBrowseFilter('all');
      setMessage(playlist ? `${playlist.name} 큐를 만들었어요.` : '플레이리스트를 찾을 수 없습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, normalizedServerUrl, requireServerUrl, sessionCookie]);

  const playTrack = useCallback(
    async (index: number) => {
      if (!visibleLibrary.length) return;
      try {
        await playLibraryFrom(normalizedServerUrl, visibleLibrary, index, sessionCookie);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [normalizedServerUrl, sessionCookie, visibleLibrary],
  );

  const runDeepLink = useCallback(async (request: OceanWaveDeepLinkRequest) => {
    setPendingDeepLink(null);
    setIsLoading(true);

    try {
      if (request.target === 'music') {
        const music = await fetchMobileMusic(normalizedServerUrl, request.id, sessionCookie);
        if (!music) {
          setMessage('요청한 음악을 찾을 수 없습니다.');
          return;
        }

        setSelectedPlaylistName(null);
        setSearchQuery('');
        setBrowseFilter('all');
        setLibrary([music]);
        await playLibraryFrom(normalizedServerUrl, [music], 0, sessionCookie);
        setMessage(`${music.name} 재생을 시작했어요.`);
        return;
      }

      const playlist = await fetchMobilePlaylist(normalizedServerUrl, request.id, sessionCookie);
      const nextMusics = playlist?.musics ?? [];
      if (!playlist || nextMusics.length === 0) {
        setMessage('요청한 플레이리스트를 찾을 수 없거나 비어 있습니다.');
        return;
      }

      setSelectedPlaylistName(playlist.name);
      setSearchQuery('');
      setBrowseFilter('all');
      setLibrary(nextMusics);
      await playLibraryFrom(normalizedServerUrl, nextMusics, 0, sessionCookie);
      setMessage(`${playlist.name} 플레이리스트 재생을 시작했어요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [normalizedServerUrl, sessionCookie]);

  const handleDeepLinkUrl = useCallback((url: string | null) => {
    if (!url) return;

    const request = parseOceanWaveDeepLink(url);
    if (!request) return;

    setPendingDeepLink(request);

    if (request.serverUrl && request.serverUrl !== normalizedServerUrl) {
      setAuthSession(null);
      setSessionCookie(null);
      setLibrary([]);
      setPlaylists([]);
      setSelectedPlaylistName(null);
      setSearchQuery('');
      setBrowseFilter('all');
      setServerUrl(request.serverUrl);
      setMessage('앱 재생 요청을 받았어요. 서버 연결을 확인하는 중입니다.');
      return;
    }

    if (!normalizedServerUrl) {
      setMessage('앱 재생 요청을 받았어요. 먼저 서버 주소를 입력해 주세요.');
      return;
    }

    if (!isAuthenticated) {
      setMessage('앱 재생 요청을 받았어요. 서버 인증을 확인해 주세요.');
    }
  }, [isAuthenticated, normalizedServerUrl]);

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
    if (!pendingDeepLink || !normalizedServerUrl || authSession || isLoading) return;
    checkSession().catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, [authSession, checkSession, isLoading, normalizedServerUrl, pendingDeepLink]);

  useEffect(() => {
    if (!pendingDeepLink || !normalizedServerUrl || !isAuthenticated || isLoading) return;
    runDeepLink(pendingDeepLink).catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, [isAuthenticated, isLoading, normalizedServerUrl, pendingDeepLink, runDeepLink]);

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

  const seekBy = useCallback(async (seconds: number) => {
    if (!canControlPlayback) return;
    const nextPosition = Math.max(0, Math.min(progress.position + seconds, progressDuration || progress.position + seconds));
    await TrackPlayer.seekTo(nextPosition);
  }, [canControlPlayback, progress.position, progressDuration]);

  const seekToTouch = useCallback(async (event: GestureResponderEvent) => {
    if (!canControlPlayback || !progressDuration) return;
    const ratio = Math.max(0, Math.min(event.nativeEvent.locationX / progressWidth, 1));
    await TrackPlayer.seekTo(ratio * progressDuration);
  }, [canControlPlayback, progressDuration, progressWidth]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={brand.background} />
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.kicker}>OCEAN WAVE MOBILE</Text>
          <Text style={styles.title}>Your phone keeps the music moving.</Text>
          <Text style={styles.description}>
            탐색과 관리는 웹에서, Android 앱은 현재 재생과 큐를 가볍게 이어받습니다.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderText}>
              <Text style={styles.label}>Server URL</Text>
              <Text style={styles.helperText}>웹 본체에 연결하면 앱은 백그라운드 재생과 큐 제어만 담당합니다.</Text>
            </View>
            <Pressable disabled={!normalizedServerUrl} onPress={openWebApp} style={[styles.webButton, !normalizedServerUrl && styles.disabledButton]}>
              <Text style={styles.webButtonText}>Open web</Text>
            </Pressable>
          </View>
          <View style={styles.serverRow}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              onChangeText={setServerUrl}
              placeholder="http://192.168.0.10:3000"
              placeholderTextColor="#71717a"
              style={styles.input}
              value={serverUrl}
            />
            <Pressable disabled={isLoading} onPress={checkSession} style={styles.primaryButton}>
              {isLoading ? <ActivityIndicator color={brand.background} /> : <Text style={styles.primaryButtonText}>Check</Text>}
            </Pressable>
          </View>

          {authSession?.authRequired && !authSession.authenticated ? (
            <View style={styles.serverRow}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setPassword}
                placeholder="Server password"
                placeholderTextColor="#71717a"
                secureTextEntry
                style={styles.input}
                value={password}
              />
              <Pressable disabled={isLoading} onPress={login} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Login</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <Text style={styles.status}>{message}</Text>
            {isAuthenticated ? (
              <Pressable disabled={isLoading} onPress={logout} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Logout</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.queueActionRow}>
            <Pressable disabled={isLoading || !isAuthenticated} onPress={loadLibrary} style={[styles.wideButton, styles.splitButton, !isAuthenticated && styles.disabledButton]}>
              <Text style={styles.wideButtonText}>Build queue</Text>
            </Pressable>
            <Pressable disabled={isLoading || !isAuthenticated} onPress={loadPlaylists} style={[styles.secondaryWideButton, styles.splitButton, !isAuthenticated && styles.disabledButton]}>
              <Text style={styles.secondaryWideButtonText}>Playlists</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.playerCard}>
          <View style={styles.nowPlayingHeader}>
            <View style={styles.nowPlayingText}>
              <Text style={styles.kicker}>NOW PLAYING</Text>
              <Text numberOfLines={1} style={styles.playerTitle}>{activeTrack?.title ?? 'No track selected'}</Text>
              <Text numberOfLines={1} style={styles.playerMeta}>{activeTrack?.artist ?? queueLabel}</Text>
            </View>
            <Text style={[styles.playbackPill, isPlaying && styles.playbackPillActive]}>{isPlaying ? 'ON AIR' : 'READY'}</Text>
          </View>

          <Pressable
            disabled={!canControlPlayback}
            onLayout={event => setProgressWidth(Math.max(event.nativeEvent.layout.width, 1))}
            onPress={seekToTouch}
            style={[styles.progressTrack, !canControlPlayback && styles.disabledButton]}
          >
            <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
          </Pressable>

          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatDuration(progress.position)}</Text>
            <Text style={styles.timeText}>{formatDuration(progressDuration)}</Text>
          </View>

          <View style={styles.controlRow}>
            <Pressable disabled={!canControlPlayback} onPress={() => seekBy(-SEEK_STEP_SECONDS)} style={[styles.controlButton, !canControlPlayback && styles.disabledButton]}>
              <Text style={styles.controlText}>-15</Text>
            </Pressable>
            <Pressable disabled={!canControlPlayback} onPress={skipPrevious} style={[styles.controlButton, !canControlPlayback && styles.disabledButton]}>
              <Text style={styles.controlText}>Prev</Text>
            </Pressable>
            <Pressable disabled={!canControlPlayback} onPress={togglePlayback} style={[styles.playButton, !canControlPlayback && styles.disabledButton]}>
              <Text style={styles.playButtonText}>{isPlaying ? 'Pause' : 'Play'}</Text>
            </Pressable>
            <Pressable disabled={!canControlPlayback} onPress={skipNext} style={[styles.controlButton, !canControlPlayback && styles.disabledButton]}>
              <Text style={styles.controlText}>Next</Text>
            </Pressable>
            <Pressable disabled={!canControlPlayback} onPress={() => seekBy(SEEK_STEP_SECONDS)} style={[styles.controlButton, !canControlPlayback && styles.disabledButton]}>
              <Text style={styles.controlText}>+15</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.queueHeader}>
          <Text style={styles.queueTitle}>{selectedPlaylistName ?? 'Phone Queue'}</Text>
          <Text style={styles.queueMeta}>{queueLabel}</Text>
        </View>

        {playlists.length ? (
          <View style={styles.playlistPanel}>
            <Text style={styles.panelLabel}>Playlists</Text>
            <View style={styles.playlistGrid}>
              {playlists.map(playlist => (
                <Pressable key={playlist.id} disabled={isLoading} onPress={() => openPlaylist(playlist.id)} style={styles.playlistChip}>
                  <Text numberOfLines={1} style={styles.playlistName}>{playlist.name}</Text>
                  <Text style={styles.playlistMeta}>{playlist.musicCount.toLocaleString()} tracks</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.browsePanel}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearchQuery}
            placeholder="Search queue candidates"
            placeholderTextColor="#71717a"
            style={styles.searchInput}
            value={searchQuery}
          />
          <View style={styles.filterRow}>
            {(['all', 'favorites', 'recent'] as BrowseFilter[]).map(filter => (
              <Pressable key={filter} onPress={() => setBrowseFilter(filter)} style={[styles.filterChip, browseFilter === filter && styles.filterChipActive]}>
                <Text style={[styles.filterText, browseFilter === filter && styles.filterTextActive]}>
                  {filter === 'all' ? 'All' : filter === 'favorites' ? 'Favorites' : 'Recent'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <FlatList
          data={visibleLibrary}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>웹 서버를 확인한 뒤 큐를 만들어 주세요.</Text>}
          renderItem={({ item, index }) => {
            const active = isSameTrack(item, activeTrackId);
            return (
              <Pressable onPress={() => playTrack(index)} style={[styles.row, active && styles.activeRow]}>
                <View style={styles.rowMain}>
                  <Text numberOfLines={1} style={[styles.songTitle, active && styles.activeText]}>{item.name}</Text>
                  <Text numberOfLines={1} style={styles.songMeta}>{item.artist?.name ?? 'Unknown Artist'} · {item.album?.name ?? 'Unknown Album'}</Text>
                </View>
                <Text style={styles.duration}>{formatDuration(item.duration)}</Text>
              </Pressable>
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: brand.background },
  container: { flex: 1, gap: 14, padding: 20, backgroundColor: brand.background },
  header: { gap: 8, paddingTop: 12 },
  kicker: { color: brand.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  title: { color: brand.text, fontSize: 30, fontWeight: '800', letterSpacing: -1.2 },
  description: { color: brand.muted, fontSize: 15, lineHeight: 22 },
  card: { gap: 10, padding: 14, borderRadius: 22, backgroundColor: brand.surface, borderWidth: 1, borderColor: brand.border },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cardHeaderText: { flex: 1, minWidth: 0, gap: 4 },
  label: { color: brand.text, fontSize: 13, fontWeight: '700' },
  helperText: { color: brand.muted, fontSize: 12, lineHeight: 17 },
  serverRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  input: { flex: 1, minHeight: 46, borderRadius: 14, paddingHorizontal: 14, color: brand.text, backgroundColor: '#111113', borderWidth: 1, borderColor: brand.border },
  primaryButton: { minHeight: 46, minWidth: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: brand.primary },
  primaryButtonText: { color: brand.background, fontSize: 14, fontWeight: '800' },
  webButton: { minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingHorizontal: 12, backgroundColor: '#18181b', borderWidth: 1, borderColor: brand.border },
  webButtonText: { color: brand.text, fontSize: 12, fontWeight: '800' },
  secondaryButton: { minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingHorizontal: 12, backgroundColor: '#27272a' },
  secondaryButtonText: { color: brand.text, fontSize: 12, fontWeight: '700' },
  queueActionRow: { flexDirection: 'row', gap: 10 },
  wideButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: brand.primary },
  splitButton: { flex: 1 },
  wideButtonText: { color: brand.background, fontSize: 14, fontWeight: '800' },
  secondaryWideButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#18181b', borderWidth: 1, borderColor: brand.border },
  secondaryWideButtonText: { color: brand.text, fontSize: 14, fontWeight: '800' },
  disabledButton: { opacity: 0.42 },
  status: { flex: 1, color: brand.muted, fontSize: 12, lineHeight: 18 },
  playerCard: { gap: 12, padding: 14, borderRadius: 22, backgroundColor: brand.surfaceRaised, borderWidth: 1, borderColor: brand.border },
  nowPlayingHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  nowPlayingText: { flex: 1, minWidth: 0 },
  playerTitle: { marginTop: 5, color: brand.text, fontSize: 18, fontWeight: '800' },
  playerMeta: { marginTop: 3, color: brand.muted, fontSize: 13 },
  playbackPill: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, color: '#a1a1aa', backgroundColor: '#18181b', fontSize: 10, fontWeight: '800', letterSpacing: 0.9 },
  playbackPillActive: { color: brand.background, backgroundColor: brand.primary },
  progressTrack: { height: 16, justifyContent: 'center', borderRadius: 999, backgroundColor: '#18181b' },
  progressFill: { height: 6, borderRadius: 999, backgroundColor: brand.primary },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { color: '#71717a', fontSize: 11, fontVariant: ['tabular-nums'] },
  controlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  controlButton: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: '#18181b' },
  controlText: { color: brand.text, fontSize: 12, fontWeight: '800' },
  playButton: { flex: 1.2, alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: 999, backgroundColor: brand.primary },
  playButtonText: { color: brand.background, fontSize: 14, fontWeight: '900' },
  queueHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  queueTitle: { color: brand.text, fontSize: 18, fontWeight: '800' },
  queueMeta: { flex: 1, textAlign: 'right', color: brand.muted, fontSize: 12 },
  playlistPanel: { gap: 8 },
  panelLabel: { color: brand.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  playlistGrid: { gap: 8 },
  playlistChip: { gap: 3, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#09090b', borderWidth: 1, borderColor: '#18181b' },
  playlistName: { color: brand.text, fontSize: 13, fontWeight: '800' },
  playlistMeta: { color: brand.muted, fontSize: 11 },
  browsePanel: { gap: 10 },
  searchInput: { minHeight: 42, borderRadius: 14, paddingHorizontal: 14, color: brand.text, backgroundColor: '#09090b', borderWidth: 1, borderColor: brand.border },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: { minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingHorizontal: 13, backgroundColor: '#18181b' },
  filterChipActive: { backgroundColor: brand.primary },
  filterText: { color: brand.muted, fontSize: 12, fontWeight: '800' },
  filterTextActive: { color: brand.background },
  listContent: { gap: 8, paddingBottom: 28 },
  empty: { paddingVertical: 28, textAlign: 'center', color: brand.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: '#09090b', borderWidth: 1, borderColor: '#18181b' },
  activeRow: { borderColor: '#2f4f3a', backgroundColor: '#0d1610' },
  rowMain: { flex: 1, minWidth: 0, gap: 4 },
  songTitle: { color: brand.text, fontSize: 15, fontWeight: '700' },
  activeText: { color: brand.primary },
  songMeta: { color: brand.muted, fontSize: 12 },
  duration: { color: '#71717a', fontSize: 12, fontVariant: ['tabular-nums'] },
});

export default App;
