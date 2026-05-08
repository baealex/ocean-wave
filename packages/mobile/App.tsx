import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  GestureResponderEvent,
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
  loginWithPassword,
  logoutSession,
  normalizeServerUrl,
  OceanWaveAuthSession,
  OceanWaveMusic,
} from './src/api/oceanWaveClient';
import { brand } from './src/config/brand';
import { playLibraryFrom, prepareTrackPlayer } from './src/player/trackPlayer';

const SEEK_STEP_SECONDS = 15;

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
  const [sessionCookie, setSessionCookie] = useState<string | null>(null);
  const [authSession, setAuthSession] = useState<OceanWaveAuthSession | null>(null);
  const [library, setLibrary] = useState<OceanWaveMusic[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('서버 연결을 확인한 뒤 백그라운드 재생 테스트를 시작할 수 있어요.');

  const normalizedServerUrl = useMemo(() => normalizeServerUrl(serverUrl), [serverUrl]);
  const previousServerUrlRef = useRef<string | null>(null);
  const isAuthenticated = authSession ? !authSession.authRequired || authSession.authenticated : false;
  const activeTrackId = activeTrack?.id ? String(activeTrack.id) : undefined;
  const queueLabel = library.length ? `${library.length.toLocaleString()} tracks loaded` : 'Load a library to build the queue';
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
      await TrackPlayer.reset();
      setMessage('로그아웃 완료. 모바일 세션을 비웠어요.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [normalizedServerUrl, requireServerUrl, sessionCookie]);

  const loadLibrary = useCallback(async () => {
    if (!requireServerUrl()) return;
    if (!isAuthenticated) {
      Alert.alert('인증 필요', '먼저 서버 연결 상태를 확인하고 로그인해 주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const nextLibrary = await fetchMobileLibrary(normalizedServerUrl, sessionCookie);
      setLibrary(nextLibrary);
      setMessage(`${nextLibrary.length.toLocaleString()}곡을 불러왔어요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, normalizedServerUrl, requireServerUrl, sessionCookie]);

  const playTrack = useCallback(
    async (index: number) => {
      if (!library.length) return;
      try {
        await playLibraryFrom(normalizedServerUrl, library, index, sessionCookie);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [library, normalizedServerUrl, sessionCookie],
  );

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
          <Text style={styles.title}>Companion player.</Text>
          <Text style={styles.description}>
            서버 인증과 백그라운드 재생을 먼저 검증하는 작은 Android 플레이어입니다.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Server URL</Text>
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

          <Pressable disabled={isLoading || !isAuthenticated} onPress={loadLibrary} style={[styles.wideButton, !isAuthenticated && styles.disabledButton]}>
            <Text style={styles.wideButtonText}>Load library</Text>
          </Pressable>
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
          <Text style={styles.queueTitle}>Queue</Text>
          <Text style={styles.queueMeta}>{queueLabel}</Text>
        </View>

        <FlatList
          data={library}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>아직 불러온 음악이 없습니다.</Text>}
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
  label: { color: brand.text, fontSize: 13, fontWeight: '700' },
  serverRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  input: { flex: 1, minHeight: 46, borderRadius: 14, paddingHorizontal: 14, color: brand.text, backgroundColor: '#111113', borderWidth: 1, borderColor: brand.border },
  primaryButton: { minHeight: 46, minWidth: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: brand.primary },
  primaryButtonText: { color: brand.background, fontSize: 14, fontWeight: '800' },
  secondaryButton: { minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingHorizontal: 12, backgroundColor: '#27272a' },
  secondaryButtonText: { color: brand.text, fontSize: 12, fontWeight: '700' },
  wideButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: brand.primary },
  wideButtonText: { color: brand.background, fontSize: 14, fontWeight: '800' },
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
