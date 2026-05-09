import { GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Track } from 'react-native-track-player';

import { brand } from '../config/brand';

type MiniPlayerProps = {
  activeTrack?: Track;
  canControlPlayback: boolean;
  isPlaying: boolean;
  playlistName?: string | null;
  progressRatio: number;
  onProgressLayout: (width: number) => void;
  onSeek: (event: GestureResponderEvent) => void;
  onPrevious: () => void;
  onTogglePlayback: () => void;
  onNext: () => void;
};

export function MiniPlayer({
  activeTrack,
  canControlPlayback,
  isPlaying,
  playlistName,
  progressRatio,
  onProgressLayout,
  onSeek,
  onPrevious,
  onTogglePlayback,
  onNext,
}: MiniPlayerProps) {
  return (
    <View style={styles.miniPlayer}>
      <Pressable
        disabled={!canControlPlayback}
        onLayout={event => onProgressLayout(Math.max(event.nativeEvent.layout.width, 1))}
        onPress={onSeek}
        style={styles.miniProgress}
      >
        <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
      </Pressable>
      <View style={styles.miniPlayerRow}>
        <View style={styles.miniMeta}>
          <Text numberOfLines={1} style={styles.miniTitle}>{activeTrack?.title ?? 'No track selected'}</Text>
          <Text numberOfLines={1} style={styles.miniSubtitle}>
            {activeTrack ? `${activeTrack.artist ?? 'Unknown Artist'} · ${playlistName ?? 'Playlist'}` : (playlistName ? 'Tap Play playlist or choose a track' : 'Choose a playlist')}
          </Text>
        </View>
        <Pressable accessibilityLabel="Previous track" disabled={!canControlPlayback} onPress={onPrevious} style={[styles.iconButton, !canControlPlayback && styles.disabledButton]}>
          <Text style={styles.transportIconText}>⏮</Text>
        </Pressable>
        <Pressable accessibilityLabel={isPlaying ? 'Pause' : 'Play'} disabled={!canControlPlayback} onPress={onTogglePlayback} style={[styles.playCircle, !canControlPlayback && styles.disabledButton]}>
          <Text style={styles.playIconText}>{isPlaying ? 'Ⅱ' : '▶'}</Text>
        </Pressable>
        <Pressable accessibilityLabel="Next track" disabled={!canControlPlayback} onPress={onNext} style={[styles.iconButton, !canControlPlayback && styles.disabledButton]}>
          <Text style={styles.transportIconText}>⏭</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  disabledButton: { opacity: 0.42 },
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
