import { GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Track } from 'react-native-track-player';

import { brand } from '../config/brand';
import { CachedArtwork } from './CachedArtwork';

type MiniPlayerTrack = Pick<Track, 'artist' | 'artwork' | 'title'>;

type MiniPlayerProps = {
  activeTrack?: MiniPlayerTrack;
  canControlPlayback: boolean;
  isPlaying: boolean;
  playlistName?: string | null;
  progressRatio: number;
  sessionCookie?: string | null;
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
  sessionCookie,
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
        <CachedArtwork cookie={sessionCookie} size={52} uri={typeof activeTrack?.artwork === 'string' ? activeTrack.artwork : null} />
        <View style={styles.miniMeta}>
          <Text numberOfLines={1} style={styles.miniTitle}>{activeTrack?.title ?? 'No track selected'}</Text>
          <Text numberOfLines={1} style={styles.miniSubtitle}>
            {activeTrack ? `${activeTrack.artist ?? 'Unknown Artist'} · ${playlistName ?? 'Playlist'}` : (playlistName ? 'Choose a track to start' : 'Choose a playlist')}
          </Text>
        </View>
        <Pressable accessibilityLabel="Previous track" disabled={!canControlPlayback} onPress={onPrevious} style={[styles.iconButton, !canControlPlayback && styles.disabledButton]}>
          <TransportGlyph direction="previous" />
        </Pressable>
        <Pressable accessibilityLabel={isPlaying ? 'Pause' : 'Play'} disabled={!canControlPlayback} onPress={onTogglePlayback} style={[styles.playCircle, !canControlPlayback && styles.disabledButton]}>
          {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
        </Pressable>
        <Pressable accessibilityLabel="Next track" disabled={!canControlPlayback} onPress={onNext} style={[styles.iconButton, !canControlPlayback && styles.disabledButton]}>
          <TransportGlyph direction="next" />
        </Pressable>
      </View>
    </View>
  );
}

function PlayGlyph() {
  return <View style={styles.playGlyph} />;
}

function PauseGlyph() {
  return (
    <View style={styles.pauseGlyph}>
      <View style={styles.pauseBar} />
      <View style={styles.pauseBar} />
    </View>
  );
}

function TransportGlyph({ direction }: { direction: 'previous' | 'next' }) {
  const isNext = direction === 'next';
  return (
    <View style={styles.transportGlyph}>
      {!isNext ? <View style={styles.transportBar} /> : null}
      <View style={isNext ? styles.nextTriangle : styles.previousTriangle} />
      {isNext ? <View style={styles.transportBar} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  disabledButton: { opacity: 0.42 },
  miniPlayer: { position: 'absolute', left: 12, right: 12, bottom: 12, overflow: 'hidden', borderRadius: 22, backgroundColor: '#18181b', borderWidth: 1, borderColor: brand.border },
  miniProgress: { height: 8, justifyContent: 'center', backgroundColor: '#27272a' },
  progressFill: { height: 4, borderRadius: 999, backgroundColor: brand.primary },
  miniPlayerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 76, paddingHorizontal: 12 },
  miniMeta: { flex: 1, minWidth: 0, gap: 3 },
  miniTitle: { color: brand.text, fontSize: 15, fontWeight: '800' },
  miniSubtitle: { color: brand.muted, fontSize: 12 },
  iconButton: { alignItems: 'center', justifyContent: 'center', width: 48, height: 44, borderRadius: 999, backgroundColor: '#27272a' },
  playCircle: { alignItems: 'center', justifyContent: 'center', width: 58, height: 46, borderRadius: 999, backgroundColor: brand.primary },
  playGlyph: { marginLeft: 3, width: 0, height: 0, borderTopWidth: 9, borderBottomWidth: 9, borderLeftWidth: 14, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: brand.background },
  pauseGlyph: { flexDirection: 'row', gap: 5 },
  pauseBar: { width: 5, height: 18, borderRadius: 999, backgroundColor: brand.background },
  transportGlyph: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  transportBar: { width: 3, height: 18, borderRadius: 999, backgroundColor: brand.text },
  previousTriangle: { width: 0, height: 0, borderTopWidth: 8, borderBottomWidth: 8, borderRightWidth: 12, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: brand.text },
  nextTriangle: { width: 0, height: 0, borderTopWidth: 8, borderBottomWidth: 8, borderLeftWidth: 12, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: brand.text },
});
