import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  RepeatMode,
  Track,
} from 'react-native-track-player';

import { albumArtUrl, audioStreamUrl, OceanWaveMusic } from '../api/oceanWaveClient';

let isPrepared = false;
let preparePromise: Promise<void> | null = null;

export type PlayableMusic = OceanWaveMusic & {
  offlineArtworkUri?: string | null;
  offlineAudioUri?: string | null;
};

function fallbackText(value: string | undefined | null, fallback: string) {
  const normalized = value?.trim();
  return normalized || fallback;
}

export async function prepareTrackPlayer() {
  if (isPrepared) return;
  if (preparePromise) return preparePromise;

  preparePromise = (async () => {
    await TrackPlayer.setupPlayer({
      autoHandleInterruptions: true,
    });

    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
      notificationCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious],
      progressUpdateEventInterval: 2,
    });

    await TrackPlayer.setRepeatMode(RepeatMode.Queue);
    isPrepared = true;
  })();

  try {
    await preparePromise;
  } finally {
    preparePromise = null;
  }
}


export async function resetTrackPlayerIfPrepared() {
  if (!isPrepared) return;
  await TrackPlayer.reset();
}

export function toTrack(serverUrl: string, music: PlayableMusic, sessionCookie?: string | null): Track {
  const isOffline = Boolean(music.offlineAudioUri);
  return {
    id: String(music.id),
    url: music.offlineAudioUri ?? audioStreamUrl(serverUrl, music.id),
    title: fallbackText(music.name, `Track ${music.id}`),
    artist: fallbackText(music.artist?.name, 'Unknown Artist'),
    album: fallbackText(music.album?.name, 'Unknown Album'),
    duration: music.duration ?? undefined,
    artwork: music.offlineArtworkUri ?? albumArtUrl(serverUrl, music.album?.cover),
    headers: !isOffline && sessionCookie ? { Cookie: sessionCookie } : undefined,
  };
}

const QUEUE_TRACK_LIMIT = 64;
const QUEUE_TRACKS_BEFORE_SELECTED = 12;

function getQueueWindow(musics: PlayableMusic[], selectedIndex: number) {
  const start = Math.max(0, Math.min(selectedIndex - QUEUE_TRACKS_BEFORE_SELECTED, Math.max(0, musics.length - QUEUE_TRACK_LIMIT)));
  const end = Math.min(musics.length, start + QUEUE_TRACK_LIMIT);

  return {
    queue: musics.slice(start, end),
    selectedQueueIndex: selectedIndex - start,
  };
}

export async function playLibraryFrom(
  serverUrl: string,
  musics: PlayableMusic[],
  index = 0,
  sessionCookie?: string | null,
) {
  const selectedIndex = Math.max(0, Math.min(index, musics.length - 1));
  const selectedMusic = musics[selectedIndex];
  if (!selectedMusic) return;

  const { queue, selectedQueueIndex } = getQueueWindow(musics, selectedIndex);

  await prepareTrackPlayer();
  await TrackPlayer.reset();
  await TrackPlayer.add(queue.map(music => toTrack(serverUrl, music, sessionCookie)));
  await TrackPlayer.skip(selectedQueueIndex);
  await TrackPlayer.play();
}
