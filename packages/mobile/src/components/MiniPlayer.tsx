import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Track } from 'react-native-track-player';

import { brand } from '../config/brand';
import { CachedArtwork } from './CachedArtwork';
import { PauseGlyph, PlayGlyph, TransportGlyph } from './PlaybackGlyphs';

type MiniPlayerTrack = Pick<Track, 'artist' | 'artwork' | 'title'>;

type MiniPlayerProps = {
  activeTrack?: MiniPlayerTrack;
  canControlPlayback: boolean;
  hasPlaybackError: boolean;
  isBuffering: boolean;
  isPlaying: boolean;
  playlistName?: string | null;
  progressRatio: number;
  sessionCookie?: string | null;
  onOpen: () => void;
  onRetryPlayback: () => void;
  onTogglePlayback: () => void;
  onNext: () => void;
};

export function MiniPlayer({
  activeTrack,
  canControlPlayback,
  hasPlaybackError,
  isBuffering,
  isPlaying,
  playlistName,
  progressRatio,
  sessionCookie,
  onOpen,
  onRetryPlayback,
  onTogglePlayback,
  onNext,
}: MiniPlayerProps) {
  return (
    <View style={styles.miniPlayer}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.miniProgress}>
        <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
      </View>
      <View style={styles.miniPlayerRow}>
        <Pressable
          accessibilityHint="Opens the full playback screen"
          accessibilityLabel={activeTrack ? `Open now playing for ${activeTrack.title ?? 'current track'}` : 'No track selected'}
          accessibilityRole="button"
          accessibilityState={{ disabled: !activeTrack }}
          disabled={!activeTrack}
          onPress={onOpen}
          style={({ pressed }) => [styles.miniInfo, pressed && activeTrack && styles.pressedInfo]}
        >
          <View style={styles.artworkFrame}>
            <CachedArtwork cookie={sessionCookie} size={brand.layout.miniPlayerArtworkSize} uri={typeof activeTrack?.artwork === 'string' ? activeTrack.artwork : null} />
          </View>
          <View style={styles.miniMeta}>
            <Text numberOfLines={1} style={styles.miniTitle}>{activeTrack?.title ?? 'No track selected'}</Text>
            <Text numberOfLines={1} style={[styles.miniSubtitle, hasPlaybackError && styles.miniSubtitleError]}>
              {hasPlaybackError
                ? 'Playback stopped · Tap play to retry'
                : activeTrack ? `${activeTrack.artist ?? 'Unknown Artist'} · ${playlistName ?? 'Playlist'}` : (playlistName ? 'Choose a track to start' : 'Choose a playlist')}
            </Text>
          </View>
        </Pressable>
        <View style={styles.controls}>
          <Pressable accessibilityLabel={isBuffering ? 'Loading track' : hasPlaybackError ? 'Retry playback' : isPlaying ? 'Pause' : 'Play'} accessibilityRole="button" accessibilityState={{ busy: isBuffering, disabled: !canControlPlayback, selected: isPlaying }} disabled={!canControlPlayback || isBuffering} onPress={hasPlaybackError ? onRetryPlayback : onTogglePlayback} style={({ pressed }) => [styles.playCircle, hasPlaybackError && styles.playCircleError, pressed && canControlPlayback && styles.pressedPrimary, !canControlPlayback && styles.disabledButton]}>
            {isBuffering ? <ActivityIndicator color={brand.colors.white} size="small" /> : isPlaying ? <PauseGlyph /> : <PlayGlyph />}
          </Pressable>
          <Pressable accessibilityLabel="Next track" accessibilityRole="button" accessibilityState={{ disabled: !canControlPlayback }} disabled={!canControlPlayback} onPress={onNext} style={({ pressed }) => [styles.iconButton, pressed && canControlPlayback && styles.pressedControl, !canControlPlayback && styles.disabledButton]}>
            <TransportGlyph direction="next" />
          </Pressable>
        </View>
      </View>
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
  miniPlayerRow: { flexDirection: 'row', alignItems: 'center', gap: brand.space.md, minHeight: brand.layout.miniPlayerRowMinHeight, paddingHorizontal: brand.space.md, paddingVertical: brand.space.sm },
  miniInfo: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: brand.space.md, borderRadius: brand.radius.lg },
  pressedInfo: { opacity: 0.72 },
  artworkFrame: { overflow: 'hidden', borderRadius: brand.radius.md, borderWidth: 1, borderColor: brand.colors.borderSubtle, backgroundColor: brand.colors.surface },
  miniMeta: { flex: 1, minWidth: 0, gap: brand.space.xs },
  miniTitle: { color: brand.colors.text, ...brand.typography.trackTitle },
  miniSubtitle: { color: brand.colors.textMuted, ...brand.typography.caption },
  miniSubtitleError: { color: brand.colors.danger },
  controls: { flexDirection: 'row', alignItems: 'center', gap: brand.space.xs },
  iconButton: { width: brand.control.iconButtonSize, height: brand.control.iconButtonSize, borderRadius: brand.radius.full, backgroundColor: brand.colors.control, ...brand.components.centeredControl },
  pressedControl: { ...brand.components.pressedControl },
  playCircle: { width: brand.control.playButtonSize, height: brand.control.playButtonSize, borderRadius: brand.radius.full, ...brand.components.primaryButton, ...brand.elevation.primary },
  playCircleError: { backgroundColor: brand.colors.dangerStrong },
  pressedPrimary: { ...brand.components.pressedPrimary },
});
