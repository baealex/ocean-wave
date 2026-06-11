import { useCallback, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
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
  const [progressWidth, setProgressWidth] = useState(1);

  const isPlaying = playbackValue === State.Playing;
  const canControlPlayback = Boolean(activeTrack);
  const progressDuration = progress.duration || activeTrack?.duration || 0;
  const progressRatio = progressDuration > 0 ? Math.min(progress.position / progressDuration, 1) : 0;

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

  const seekToTouch = useCallback(async (event: GestureResponderEvent) => {
    if (!canControlPlayback || !progressDuration) return;
    const ratio = Math.max(0, Math.min(event.nativeEvent.locationX / progressWidth, 1));
    await TrackPlayer.seekTo(ratio * progressDuration);
  }, [canControlPlayback, progressDuration, progressWidth]);

  const seekByStep = useCallback(async (direction: 'backward' | 'forward') => {
    if (!canControlPlayback || !progressDuration) return;
    const offset = direction === 'forward' ? ACCESSIBLE_SEEK_STEP_SECONDS : -ACCESSIBLE_SEEK_STEP_SECONDS;
    const nextPosition = Math.max(0, Math.min(progress.position + offset, progressDuration));
    await TrackPlayer.seekTo(nextPosition);
  }, [canControlPlayback, progress.position, progressDuration]);

  return {
    activeTrack,
    canControlPlayback,
    isPlaying,
    progressRatio,
    seekByStep,
    seekToTouch,
    setProgressWidth,
    skipNext,
    skipPrevious,
    togglePlayback,
  };
}
