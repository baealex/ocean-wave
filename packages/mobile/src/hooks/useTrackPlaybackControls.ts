import { useCallback } from 'react';
import TrackPlayer, {
  State,
  useActiveTrack,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';

function getPlaybackStateValue(playbackState: ReturnType<typeof usePlaybackState>) {
  return 'state' in playbackState ? playbackState.state : playbackState;
}

const ACCESSIBLE_SEEK_STEP_SECONDS = 10;

export function useTrackPlaybackControls() {
  const playbackState = usePlaybackState();
  const playbackValue = getPlaybackStateValue(playbackState);
  const activeTrack = useActiveTrack();
  const progress = useProgress(500);

  const isPlaying = playbackValue === State.Playing;
  const isBuffering = playbackValue === State.Loading || playbackValue === State.Buffering;
  const hasPlaybackError = playbackValue === State.Error;
  const canControlPlayback = Boolean(activeTrack);
  const progressDuration = progress.duration || activeTrack?.duration || 0;
  const progressRatio = progressDuration > 0 ? Math.max(0, Math.min(progress.position / progressDuration, 1)) : 0;

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

  const seekToRatio = useCallback(async (ratio: number) => {
    if (!canControlPlayback || !progressDuration) return;
    const clampedRatio = Math.max(0, Math.min(ratio, 1));
    await TrackPlayer.seekTo(clampedRatio * progressDuration);
  }, [canControlPlayback, progressDuration]);

  const seekByStep = useCallback(async (direction: 'backward' | 'forward') => {
    if (!canControlPlayback || !progressDuration) return;
    const offset = direction === 'forward' ? ACCESSIBLE_SEEK_STEP_SECONDS : -ACCESSIBLE_SEEK_STEP_SECONDS;
    const nextPosition = Math.max(0, Math.min(progress.position + offset, progressDuration));
    await TrackPlayer.seekTo(nextPosition);
  }, [canControlPlayback, progress.position, progressDuration]);

  const retryPlayback = useCallback(async () => {
    if (!activeTrack) return;
    await TrackPlayer.retry().catch(() => undefined);
    await TrackPlayer.play().catch(() => undefined);
  }, [activeTrack]);

  return {
    activeTrack,
    canControlPlayback,
    hasPlaybackError,
    isBuffering,
    isPlaying,
    progressDuration,
    progressPosition: progress.position,
    progressRatio,
    retryPlayback,
    seekByStep,
    seekToRatio,
    skipNext,
    skipPrevious,
    togglePlayback,
  };
}
