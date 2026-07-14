import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import TrackPlayer, { RepeatMode, Track } from 'react-native-track-player';
import { SafeAreaView } from 'react-native-safe-area-context';

import { brand } from '../config/brand';
import { formatDuration } from '../utils/time';
import { CachedArtwork } from './CachedArtwork';
import { PauseGlyph, PlayGlyph, TransportGlyph } from './PlaybackGlyphs';

export type NowPlayingTrack = Pick<Track, 'album' | 'artist' | 'artwork' | 'duration' | 'title'> & {
  id?: string | number;
};

type NowPlayingScreenProps = {
  activeTrack?: NowPlayingTrack;
  canControlPlayback: boolean;
  hasPlaybackError: boolean;
  isBuffering: boolean;
  isPlaying: boolean;
  playlistName?: string | null;
  progressDuration: number;
  progressPosition: number;
  progressRatio: number;
  sessionCookie?: string | null;
  visible: boolean;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onRetryPlayback: () => void;
  onSeekByStep: (direction: 'backward' | 'forward') => void;
  onSeekRatio: (ratio: number) => void;
  onTogglePlayback: () => void;
};

export function NowPlayingScreen({
  activeTrack,
  canControlPlayback,
  hasPlaybackError,
  isBuffering,
  isPlaying,
  playlistName,
  progressDuration,
  progressPosition,
  progressRatio,
  sessionCookie,
  visible,
  onClose,
  onNext,
  onPrevious,
  onRetryPlayback,
  onSeekByStep,
  onSeekRatio,
  onTogglePlayback,
}: NowPlayingScreenProps) {
  const { height, width } = useWindowDimensions();
  const [progressWidth, setProgressWidth] = useState(1);
  const [upNext, setUpNext] = useState<Track[]>([]);
  const [queueSummary, setQueueSummary] = useState('Loading queue…');
  const [queueEmptyMessage, setQueueEmptyMessage] = useState('Loading queue…');
  const isCompactHeight = height < 700;
  const maxArtworkWidth = Math.max(width - 48, 96);
  const artworkSize = Math.min(
    maxArtworkWidth,
    Math.max(isCompactHeight ? 128 : 160, height * (isCompactHeight ? 0.28 : 0.39)),
    isCompactHeight ? 240 : 360,
  );

  useEffect(() => {
    if (!visible) return undefined;

    let cancelled = false;
    setUpNext([]);
    setQueueSummary('Loading queue…');
    setQueueEmptyMessage('Loading queue…');

    Promise.all([TrackPlayer.getQueue(), TrackPlayer.getActiveTrackIndex(), TrackPlayer.getRepeatMode()])
      .then(([queue, activeIndex, repeatMode]) => {
        if (cancelled) return;

        const resolvedIndex = activeIndex ?? queue.findIndex(track => String(track.id) === String(activeTrack?.id));
        const nextIndex = resolvedIndex >= 0 ? resolvedIndex + 1 : 0;
        const repeatsQueue = repeatMode === RepeatMode.Queue;
        const repeatsTrack = repeatMode === RepeatMode.Track;

        if (repeatsTrack) {
          setUpNext([]);
          setQueueSummary('Track repeats');
          setQueueEmptyMessage('This track will repeat.');
          return;
        }

        if (repeatsQueue && queue.length > 0) {
          const queueCursor = resolvedIndex >= 0 ? resolvedIndex : -1;
          const followingTrackCount = resolvedIndex >= 0 ? Math.max(queue.length - 1, 0) : queue.length;
          const visibleTrackCount = Math.min(followingTrackCount, 3);
          const followingTracks = Array.from(
            { length: visibleTrackCount },
            (_, offset) => queue[(queueCursor + offset + 1) % queue.length],
          ).filter((track): track is Track => Boolean(track));

          setUpNext(followingTracks);
          setQueueSummary(`${queue.length.toLocaleString()} in queue · repeats`);
          setQueueEmptyMessage('This track will repeat.');
          return;
        }

        const remaining = Math.max(queue.length - nextIndex, 0);

        setUpNext(queue.slice(nextIndex, nextIndex + 3));
        setQueueSummary(`${remaining.toLocaleString()} remaining`);
        setQueueEmptyMessage('Queue ends after this track.');
      })
      .catch(() => {
        if (cancelled) return;
        setUpNext([]);
        setQueueSummary('Queue unavailable');
        setQueueEmptyMessage('Unable to load the current queue.');
      });

    return () => {
      cancelled = true;
    };
  }, [activeTrack?.id, isBuffering, visible]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent={false}
      visible={visible}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View style={styles.page}>
          <View style={styles.header}>
            <Pressable
              accessibilityLabel="Close now playing"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.headerButton, pressed && styles.pressedControl]}
            >
              <View style={styles.downChevron} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.headerEyebrow}>NOW PLAYING</Text>
              <Text numberOfLines={1} style={styles.headerTitle}>{playlistName ?? 'Queue'}</Text>
            </View>
            <View style={styles.headerButton} />
          </View>

          <ScrollView
            contentContainerStyle={[styles.content, isCompactHeight && styles.contentCompact]}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.ambientGlow, isCompactHeight && styles.ambientGlowCompact, { width: artworkSize * 0.92, height: artworkSize * 0.92, borderRadius: artworkSize }]} />
            <View style={styles.artworkShadow}>
              <CachedArtwork
                cookie={sessionCookie}
                radius={brand.radius.xl}
                size={artworkSize}
                uri={typeof activeTrack?.artwork === 'string' ? activeTrack.artwork : null}
              />
            </View>

            <View style={[styles.metadata, isCompactHeight && styles.metadataCompact]}>
              <Text numberOfLines={2} style={[styles.trackTitle, isCompactHeight && styles.trackTitleCompact]}>{activeTrack?.title ?? 'No track selected'}</Text>
              <Text numberOfLines={1} style={styles.trackArtist}>{activeTrack?.artist ?? 'Unknown Artist'}</Text>
              {activeTrack?.album ? <Text numberOfLines={1} style={styles.trackAlbum}>{activeTrack.album}</Text> : null}
            </View>

            <View style={styles.progressSection}>
              <Pressable
                accessibilityActions={[
                  { name: 'increment', label: 'Seek forward 10 seconds' },
                  { name: 'decrement', label: 'Seek backward 10 seconds' },
                ]}
                accessibilityLabel="Playback progress"
                accessibilityRole="adjustable"
                accessibilityState={{ disabled: !canControlPlayback }}
                accessibilityValue={{ min: 0, max: 100, now: Math.round(progressRatio * 100) }}
                disabled={!canControlPlayback}
                onAccessibilityAction={event => {
                  if (event.nativeEvent.actionName === 'increment') onSeekByStep('forward');
                  if (event.nativeEvent.actionName === 'decrement') onSeekByStep('backward');
                }}
                onLayout={event => setProgressWidth(Math.max(event.nativeEvent.layout.width, 1))}
                onPress={event => onSeekRatio(event.nativeEvent.locationX / progressWidth)}
                style={styles.progressHitArea}
              >
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
                  <View style={[styles.progressThumb, { left: `${progressRatio * 100}%` }]} />
                </View>
              </Pressable>
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{formatDuration(progressPosition)}</Text>
                <Text style={styles.timeText}>{formatDuration(progressDuration || activeTrack?.duration)}</Text>
              </View>
            </View>

            {hasPlaybackError ? (
              <View accessibilityLiveRegion="assertive" style={styles.playbackError}>
                <View style={styles.playbackErrorCopy}>
                  <Text style={styles.playbackErrorTitle}>Playback stopped</Text>
                  <Text style={styles.playbackErrorBody}>The track could not continue playing.</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={onRetryPlayback} style={({ pressed }) => [styles.retryButton, pressed && styles.pressedSurface]}>
                  <Text style={styles.retryButtonText}>Try again</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.transportControls}>
              <Pressable
                accessibilityLabel="Previous track"
                accessibilityRole="button"
                accessibilityState={{ disabled: !canControlPlayback }}
                disabled={!canControlPlayback}
                onPress={onPrevious}
                style={({ pressed }) => [styles.transportButton, pressed && canControlPlayback && styles.pressedControl, !canControlPlayback && styles.disabledButton]}
              >
                <TransportGlyph direction="previous" />
              </Pressable>
              <Pressable
                accessibilityLabel={isBuffering ? 'Loading track' : isPlaying ? 'Pause' : 'Play'}
                accessibilityRole="button"
                accessibilityState={{ busy: isBuffering, disabled: !canControlPlayback, selected: isPlaying }}
                disabled={!canControlPlayback || isBuffering}
                onPress={onTogglePlayback}
                style={({ pressed }) => [styles.primaryTransportButton, pressed && canControlPlayback && styles.pressedPrimary, !canControlPlayback && styles.disabledButton]}
              >
                {isBuffering ? <ActivityIndicator color={brand.colors.white} size="small" /> : isPlaying ? <PauseGlyph /> : <PlayGlyph />}
              </Pressable>
              <Pressable
                accessibilityLabel="Next track"
                accessibilityRole="button"
                accessibilityState={{ disabled: !canControlPlayback }}
                disabled={!canControlPlayback}
                onPress={onNext}
                style={({ pressed }) => [styles.transportButton, pressed && canControlPlayback && styles.pressedControl, !canControlPlayback && styles.disabledButton]}
              >
                <TransportGlyph direction="next" />
              </Pressable>
            </View>

            <View style={styles.queueSection}>
              <View style={styles.queueHeader}>
                <View>
                  <Text style={styles.queueEyebrow}>QUEUE</Text>
                  <Text style={styles.queueTitle}>Up next</Text>
                </View>
                <Text style={styles.queueCount}>{queueSummary}</Text>
              </View>
              {upNext.length > 0 ? (
                <View style={styles.queueRows}>
                  {upNext.map((track, index) => (
                    <View key={`${String(track.id)}-${index}`} style={styles.queueRow}>
                      <Text style={styles.queueRank}>{index + 1}</Text>
                      <CachedArtwork
                        cookie={sessionCookie}
                        radius={brand.radius.md}
                        size={48}
                        uri={typeof track.artwork === 'string' ? track.artwork : null}
                      />
                      <View style={styles.queueTrackCopy}>
                        <Text numberOfLines={1} style={styles.queueTrackTitle}>{track.title ?? 'Untitled track'}</Text>
                        <Text numberOfLines={1} style={styles.queueTrackArtist}>{track.artist ?? 'Unknown Artist'}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.queueEmpty}>{queueEmptyMessage}</Text>
              )}
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: brand.background },
  page: { flex: 1, backgroundColor: brand.background },
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: brand.space.lg },
  headerButton: { width: 48, height: 48, borderRadius: brand.radius.full, ...brand.components.centeredControl },
  downChevron: { width: 13, height: 13, borderRightWidth: 2.5, borderBottomWidth: 2.5, borderColor: brand.colors.text, transform: [{ rotate: '45deg' }, { translateY: -3 }] },
  headerCopy: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: brand.space.sm },
  headerEyebrow: { color: brand.colors.textSubtle, ...brand.typography.kicker },
  headerTitle: { maxWidth: '100%', color: brand.colors.text, ...brand.typography.label },
  content: { alignItems: 'center', gap: brand.space.xl, paddingHorizontal: 24, paddingBottom: 48 },
  contentCompact: { gap: brand.space.md, paddingBottom: 32 },
  ambientGlow: { position: 'absolute', top: 34, backgroundColor: brand.colors.primaryWash, opacity: 0.72, transform: [{ scale: 1.14 }] },
  ambientGlowCompact: { top: 12 },
  artworkShadow: { ...brand.elevation.floating },
  metadata: { width: '100%', alignItems: 'center', gap: brand.space.xs, paddingTop: brand.space.xs },
  metadataCompact: { gap: 2, paddingTop: 0 },
  trackTitle: { maxWidth: '100%', textAlign: 'center', color: brand.colors.text, fontSize: 27, lineHeight: 33, fontWeight: '900' },
  trackTitleCompact: { fontSize: 22, lineHeight: 27 },
  trackArtist: { maxWidth: '100%', textAlign: 'center', color: brand.colors.textMuted, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  trackAlbum: { maxWidth: '100%', textAlign: 'center', color: brand.colors.textSubtle, ...brand.typography.caption },
  progressSection: { width: '100%' },
  progressHitArea: { height: 48, justifyContent: 'center' },
  progressTrack: { height: 6, borderRadius: brand.radius.full, backgroundColor: brand.colors.border, overflow: 'visible' },
  progressFill: { height: 6, borderRadius: brand.radius.full, backgroundColor: brand.colors.primary },
  progressThumb: { position: 'absolute', top: -5, width: 16, height: 16, marginLeft: -8, borderRadius: brand.radius.full, backgroundColor: brand.colors.white },
  timeRow: { marginTop: -8, flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { color: brand.colors.textSubtle, ...brand.typography.caption, fontVariant: ['tabular-nums'] },
  playbackError: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: brand.space.md, padding: brand.space.md, borderRadius: brand.radius.lg, backgroundColor: brand.colors.dangerWash, borderWidth: 1, borderColor: brand.colors.dangerBorder },
  playbackErrorCopy: { flex: 1, minWidth: 0, gap: 2 },
  playbackErrorTitle: { color: brand.colors.text, ...brand.typography.label },
  playbackErrorBody: { color: brand.colors.textMuted, ...brand.typography.caption },
  retryButton: { minHeight: 48, justifyContent: 'center', paddingHorizontal: brand.space.lg, borderRadius: brand.radius.full, backgroundColor: brand.colors.dangerSubtle, borderWidth: 1, borderColor: brand.colors.dangerBorder },
  retryButtonText: { color: brand.colors.danger, ...brand.typography.label },
  transportControls: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  transportButton: { width: 56, height: 56, borderRadius: brand.radius.full, backgroundColor: brand.colors.control, ...brand.components.centeredControl },
  primaryTransportButton: { width: 76, height: 76, borderRadius: brand.radius.full, ...brand.components.primaryButton, ...brand.elevation.primary },
  queueSection: { width: '100%', gap: brand.space.md, marginTop: brand.space.sm, padding: brand.space.lg, borderRadius: brand.radius.xl, ...brand.components.surfaceCard },
  queueHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: brand.space.md },
  queueEyebrow: { color: brand.colors.primary, ...brand.typography.kicker },
  queueTitle: { color: brand.colors.text, ...brand.typography.sectionTitle },
  queueCount: { color: brand.colors.textSubtle, ...brand.typography.caption },
  queueRows: { gap: brand.space.sm },
  queueRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: brand.space.md },
  queueRank: { width: 16, textAlign: 'center', color: brand.colors.textSubtle, ...brand.typography.caption },
  queueTrackCopy: { flex: 1, minWidth: 0, gap: 2 },
  queueTrackTitle: { color: brand.colors.text, ...brand.typography.trackTitle },
  queueTrackArtist: { color: brand.colors.textMuted, ...brand.typography.caption },
  queueEmpty: { color: brand.colors.textMuted, ...brand.typography.status },
  pressedControl: { ...brand.components.pressedControl },
  pressedPrimary: { ...brand.components.pressedPrimary },
  pressedSurface: { ...brand.components.pressedSurface },
  disabledButton: { ...brand.components.disabledButton },
});
