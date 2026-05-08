import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  RepeatMode,
  Track,
} from 'react-native-track-player';

import { albumArtUrl, audioStreamUrl, OceanWaveMusic } from '../api/oceanWaveClient';

let isPrepared = false;

export async function prepareTrackPlayer() {
  if (isPrepared) return;

  await TrackPlayer.setupPlayer({
    autoHandleInterruptions: true,
  });

  await TrackPlayer.updateOptions({
    android: {
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
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
    notificationCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
    ],
    progressUpdateEventInterval: 2,
  });

  await TrackPlayer.setRepeatMode(RepeatMode.Queue);
  isPrepared = true;
}

export function toTrack(serverUrl: string, music: OceanWaveMusic, sessionCookie?: string | null): Track {
  return {
    id: String(music.id),
    url: audioStreamUrl(serverUrl, music.id),
    title: music.name,
    artist: music.artist?.name ?? 'Unknown Artist',
    album: music.album?.name ?? undefined,
    duration: music.duration ?? undefined,
    artwork: albumArtUrl(serverUrl, music.album?.cover),
    headers: sessionCookie ? { Cookie: sessionCookie } : undefined,
  };
}

export async function playLibraryFrom(
  serverUrl: string,
  musics: OceanWaveMusic[],
  index = 0,
  sessionCookie?: string | null,
) {
  await prepareTrackPlayer();
  await TrackPlayer.reset();
  await TrackPlayer.add(musics.map(music => toTrack(serverUrl, music, sessionCookie)));
  await TrackPlayer.skip(index);
  await TrackPlayer.play();
}
