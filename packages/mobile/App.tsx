import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import TrackPlayer, { State, usePlaybackState } from 'react-native-track-player';

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

function formatDuration(duration?: number | null) {
  if (!duration) return '--:--';
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function getPlaybackStateValue(playbackState: ReturnType<typeof usePlaybackState>) {
  return 'state' in playbackState ? playbackState.state : playbackState;
}

function App() {
  const playbackState = usePlaybackState();
  const playbackValue = getPlaybackStateValue(playbackState);
  const isPlaying = playbackValue === State.Playing;
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
    if (isPlaying) {
      await TrackPlayer.pause();
      return;
    }
    await TrackPlayer.play();
  }, [isPlaying]);

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

        <View style={styles.playerBar}>
          <View>
            <Text style={styles.kicker}>PLAYER</Text>
            <Text style={styles.playerText}>{isPlaying ? 'Playing in background-ready mode' : 'Ready'}</Text>
          </View>
          <Pressable onPress={togglePlayback} style={styles.playButton}>
            <Text style={styles.playButtonText}>{isPlaying ? 'Pause' : 'Play'}</Text>
          </Pressable>
        </View>

        <FlatList
          data={library}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>아직 불러온 음악이 없습니다.</Text>}
          renderItem={({ item, index }) => (
            <Pressable onPress={() => playTrack(index)} style={styles.row}>
              <View style={styles.rowMain}>
                <Text numberOfLines={1} style={styles.songTitle}>{item.name}</Text>
                <Text numberOfLines={1} style={styles.songMeta}>{item.artist?.name ?? 'Unknown Artist'} · {item.album?.name ?? 'Unknown Album'}</Text>
              </View>
              <Text style={styles.duration}>{formatDuration(item.duration)}</Text>
            </Pressable>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: brand.background },
  container: { flex: 1, gap: 16, padding: 20, backgroundColor: brand.background },
  header: { gap: 8, paddingTop: 12 },
  kicker: { color: brand.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  title: { color: brand.text, fontSize: 32, fontWeight: '800', letterSpacing: -1.2 },
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
  playerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: 14, borderRadius: 20, backgroundColor: brand.surfaceRaised },
  playerText: { marginTop: 4, color: brand.text, fontSize: 14, fontWeight: '700' },
  playButton: { alignItems: 'center', justifyContent: 'center', minHeight: 42, minWidth: 74, borderRadius: 999, backgroundColor: brand.primary },
  playButtonText: { color: brand.background, fontSize: 14, fontWeight: '800' },
  listContent: { gap: 8, paddingBottom: 28 },
  empty: { paddingVertical: 28, textAlign: 'center', color: brand.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: '#09090b', borderWidth: 1, borderColor: '#18181b' },
  rowMain: { flex: 1, minWidth: 0, gap: 4 },
  songTitle: { color: brand.text, fontSize: 15, fontWeight: '700' },
  songMeta: { color: brand.muted, fontSize: 12 },
  duration: { color: '#71717a', fontSize: 12, fontVariant: ['tabular-nums'] },
});

export default App;
