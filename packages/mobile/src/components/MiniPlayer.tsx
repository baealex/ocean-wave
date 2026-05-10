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
        <View style={styles.artworkFrame}>
          <CachedArtwork cookie={sessionCookie} size={54} uri={typeof activeTrack?.artwork === 'string' ? activeTrack.artwork : null} />
        </View>
        <View style={styles.miniMeta}>
          <Text numberOfLines={1} style={styles.miniTitle}>{activeTrack?.title ?? 'No track selected'}</Text>
          <Text numberOfLines={1} style={styles.miniSubtitle}>
            {activeTrack ? `${activeTrack.artist ?? 'Unknown Artist'} · ${playlistName ?? 'Playlist'}` : (playlistName ? 'Choose a track to start' : 'Choose a playlist')}
          </Text>
        </View>
        <View style={styles.controls}>
          <Pressable accessibilityLabel="Previous track" disabled={!canControlPlayback} onPress={onPrevious} style={({ pressed }) => [styles.iconButton, pressed && canControlPlayback && styles.pressedButton, !canControlPlayback && styles.disabledButton]}>
            <TransportGlyph direction="previous" />
          </Pressable>
          <Pressable accessibilityLabel={isPlaying ? 'Pause' : 'Play'} disabled={!canControlPlayback} onPress={onTogglePlayback} style={({ pressed }) => [styles.playCircle, pressed && canControlPlayback && styles.playCirclePressed, !canControlPlayback && styles.disabledButton]}>
            {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
          </Pressable>
          <Pressable accessibilityLabel="Next track" disabled={!canControlPlayback} onPress={onNext} style={({ pressed }) => [styles.iconButton, pressed && canControlPlayback && styles.pressedButton, !canControlPlayback && styles.disabledButton]}>
            <TransportGlyph direction="next" />
          </Pressable>
        </View>
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
  disabledButton: { opacity: 0.38 },
  miniPlayer: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    overflow: 'hidden',
    borderRadius: 28,
    backgroundColor: 'rgba(24,24,27,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.38,
    shadowRadius: 28,
    elevation: 18,
  },
  miniProgress: { height: 6, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  progressFill: { height: 6, borderRadius: 999, backgroundColor: brand.primary },
  miniPlayerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 82, paddingHorizontal: 13, paddingVertical: 10 },
  artworkFrame: { overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: '#09090b' },
  miniMeta: { flex: 1, minWidth: 0, gap: 4 },
  miniTitle: { color: brand.text, fontSize: 15, fontWeight: '900', letterSpacing: -0.2 },
  miniSubtitle: { color: brand.muted, fontSize: 12, lineHeight: 16 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.055)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  iconButton: { alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  pressedButton: { transform: [{ scale: 0.94 }], backgroundColor: 'rgba(255,255,255,0.14)' },
  playCircle: { alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 999, backgroundColor: brand.primary, shadowColor: brand.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.38, shadowRadius: 14, elevation: 10 },
  playCirclePressed: { transform: [{ scale: 0.95 }], backgroundColor: '#a78bfa' },
  playGlyph: { marginLeft: 3, width: 0, height: 0, borderTopWidth: 9, borderBottomWidth: 9, borderLeftWidth: 14, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#ffffff' },
  pauseGlyph: { flexDirection: 'row', gap: 5 },
  pauseBar: { width: 5, height: 18, borderRadius: 999, backgroundColor: '#ffffff' },
  transportGlyph: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  transportBar: { width: 3, height: 16, borderRadius: 999, backgroundColor: brand.text },
  previousTriangle: { width: 0, height: 0, borderTopWidth: 7, borderBottomWidth: 7, borderRightWidth: 10, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: brand.text },
  nextTriangle: { width: 0, height: 0, borderTopWidth: 7, borderBottomWidth: 7, borderLeftWidth: 10, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: brand.text },
});
