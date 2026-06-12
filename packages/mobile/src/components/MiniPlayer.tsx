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
  onSeekByStep: (direction: 'backward' | 'forward') => void;
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
  onSeekByStep,
  onPrevious,
  onTogglePlayback,
  onNext,
}: MiniPlayerProps) {
  return (
    <View style={styles.miniPlayer}>
      <Pressable
        accessibilityLabel="Playback progress"
        accessibilityRole="adjustable"
        accessibilityActions={[
          { name: 'increment', label: 'Seek forward 10 seconds' },
          { name: 'decrement', label: 'Seek backward 10 seconds' },
        ]}
        accessibilityState={{ disabled: !canControlPlayback }}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progressRatio * 100) }}
        disabled={!canControlPlayback}
        onLayout={event => onProgressLayout(Math.max(event.nativeEvent.layout.width, 1))}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'increment') {
            onSeekByStep('forward');
          }

          if (event.nativeEvent.actionName === 'decrement') {
            onSeekByStep('backward');
          }
        }}
        onPress={onSeek}
        style={styles.miniProgress}
      >
        <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
      </Pressable>
      <View style={styles.miniPlayerRow}>
        <View style={styles.artworkFrame}>
          <CachedArtwork cookie={sessionCookie} size={brand.layout.miniPlayerArtworkSize} uri={typeof activeTrack?.artwork === 'string' ? activeTrack.artwork : null} />
        </View>
        <View style={styles.miniMeta}>
          <Text numberOfLines={1} style={styles.miniTitle}>{activeTrack?.title ?? 'No track selected'}</Text>
          <Text numberOfLines={1} style={styles.miniSubtitle}>
            {activeTrack ? `${activeTrack.artist ?? 'Unknown Artist'} · ${playlistName ?? 'Playlist'}` : (playlistName ? 'Choose a track to start' : 'Choose a playlist')}
          </Text>
        </View>
        <View style={styles.controls}>
          <Pressable accessibilityLabel="Previous track" accessibilityRole="button" accessibilityState={{ disabled: !canControlPlayback }} disabled={!canControlPlayback} onPress={onPrevious} style={({ pressed }) => [styles.iconButton, pressed && canControlPlayback && styles.pressedControl, !canControlPlayback && styles.disabledButton]}>
            <TransportGlyph direction="previous" />
          </Pressable>
          <Pressable accessibilityLabel={isPlaying ? 'Pause' : 'Play'} accessibilityRole="button" accessibilityState={{ disabled: !canControlPlayback, selected: isPlaying }} disabled={!canControlPlayback} onPress={onTogglePlayback} style={({ pressed }) => [styles.playCircle, pressed && canControlPlayback && styles.pressedPrimary, !canControlPlayback && styles.disabledButton]}>
            {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
          </Pressable>
          <Pressable accessibilityLabel="Next track" accessibilityRole="button" accessibilityState={{ disabled: !canControlPlayback }} disabled={!canControlPlayback} onPress={onNext} style={({ pressed }) => [styles.iconButton, pressed && canControlPlayback && styles.pressedControl, !canControlPlayback && styles.disabledButton]}>
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
  disabledButton: { ...brand.components.disabledButton },
  miniPlayer: {
    position: 'absolute',
    left: brand.space.lg,
    right: brand.space.lg,
    bottom: brand.space.lg,
    overflow: 'hidden',
    borderRadius: brand.radius['2xl'],
    backgroundColor: brand.colors.surfaceOverlay,
    borderWidth: 1,
    borderColor: brand.colors.borderSubtle,
    ...brand.elevation.floating,
  },
  miniProgress: { height: 6, justifyContent: 'center', backgroundColor: brand.colors.borderSubtle },
  progressFill: { height: 6, borderRadius: brand.radius.full, backgroundColor: brand.colors.primary },
  miniPlayerRow: { flexDirection: 'row', alignItems: 'center', gap: brand.space.md, minHeight: brand.layout.miniPlayerRowMinHeight, paddingHorizontal: brand.space.lg, paddingVertical: brand.space.md },
  artworkFrame: { overflow: 'hidden', borderRadius: brand.radius.md, borderWidth: 1, borderColor: brand.colors.borderSubtle, backgroundColor: brand.colors.surface },
  miniMeta: { flex: 1, minWidth: 0, gap: brand.space.xs },
  miniTitle: { color: brand.colors.text, ...brand.typography.trackTitle },
  miniSubtitle: { color: brand.colors.textMuted, ...brand.typography.caption },
  controls: { flexDirection: 'row', alignItems: 'center', gap: brand.space.sm, padding: brand.space.xs, borderRadius: brand.radius.full, backgroundColor: brand.colors.controlPanel, borderWidth: 1, borderColor: brand.colors.controlBorder },
  iconButton: { width: brand.control.iconButtonSize, height: brand.control.iconButtonSize, borderRadius: brand.radius.full, backgroundColor: brand.colors.control, ...brand.components.centeredControl },
  pressedControl: { ...brand.components.pressedControl },
  playCircle: { width: brand.control.playButtonSize, height: brand.control.playButtonSize, borderRadius: brand.radius.full, ...brand.components.primaryButton, ...brand.elevation.primary },
  pressedPrimary: { ...brand.components.pressedPrimary },
  playGlyph: { marginLeft: 3, width: 0, height: 0, borderTopWidth: 9, borderBottomWidth: 9, borderLeftWidth: 14, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: brand.colors.white },
  pauseGlyph: { flexDirection: 'row', gap: brand.icon.pauseGap },
  pauseBar: { width: 5, height: 18, borderRadius: brand.radius.full, backgroundColor: brand.colors.white },
  transportGlyph: { flexDirection: 'row', alignItems: 'center', gap: brand.icon.transportGap },
  transportBar: { width: 3, height: 16, borderRadius: brand.radius.full, backgroundColor: brand.colors.text },
  previousTriangle: { width: 0, height: 0, borderTopWidth: 7, borderBottomWidth: 7, borderRightWidth: 10, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: brand.colors.text },
  nextTriangle: { width: 0, height: 0, borderTopWidth: 7, borderBottomWidth: 7, borderLeftWidth: 10, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: brand.colors.text },
});
