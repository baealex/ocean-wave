import { useCallback, useEffect, useMemo, useState } from 'react';
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

import { fetchMobileLibrary, normalizeServerUrl, OceanWaveMusic } from './src/api/oceanWaveClient';
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
  const [library, setLibrary] = useState<OceanWaveMusic[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('서버를 연결하면 백그라운드 재생 테스트를 시작할 수 있어요.');

  const normalizedServerUrl = useMemo(() => normalizeServerUrl(serverUrl), [serverUrl]);

  useEffect(() => {
    prepareTrackPlayer().catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  const loadLibrary = useCallback(async () => {
    if (!normalizedServerUrl) {
      Alert.alert('서버 주소 필요', '예: http://192.168.0.10:3000');
      return;
    }

    setIsLoading(true);
    try {
      const nextLibrary = await fetchMobileLibrary(normalizedServerUrl);
      setLibrary(nextLibrary);
      setMessage(`${nextLibrary.length.toLocaleString()}곡을 불러왔어요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [normalizedServerUrl]);

  const playTrack = useCallback(
    async (index: number) => {
      if (!library.length) return;
      try {
        await playLibraryFrom(normalizedServerUrl, library, index);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [library, normalizedServerUrl],
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
          <Text style={styles.title}>Android player first.</Text>
          <Text style={styles.description}>
            웹 기능은 덜어내고, 서버 라이브러리와 백그라운드 재생만 먼저 검증합니다.
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
            <Pressable disabled={isLoading} onPress={loadLibrary} style={styles.primaryButton}>
              {isLoading ? <ActivityIndicator color={brand.background} /> : <Text style={styles.primaryButtonText}>Load</Text>}
            </Pressable>
          </View>
          <Text style={styles.status}>{message}</Text>
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
  input: { flex: 1, minHeight: 46, borderRadius: 14, paddingHorizontal: 14, color: brand.text, backgroundColor: '#111113', borderWidth: 1, borderColor: brand.border },
  primaryButton: { minHeight: 46, minWidth: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: brand.primary },
  primaryButtonText: { color: brand.background, fontSize: 14, fontWeight: '800' },
  status: { color: brand.muted, fontSize: 12, lineHeight: 18 },
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
