import { albumArtUrl, audioStreamUrl, OceanWaveMusic, OceanWavePlaylist } from '../api/oceanWaveClient';
import { ServerProfile } from '../app/serverProfiles';
import {
  cacheRemoteImage,
  deleteLocalFile,
  downloadRemoteFile,
  getStoredString,
  setStoredString,
} from '../storage/nativeKeyValue';

const OFFLINE_PLAYLISTS_KEY = 'ocean-wave.offlinePlaylists.v1';
const CACHED_PLAYLISTS_KEY = 'ocean-wave.cachedPlaylists.v1';

export type OfflineMusic = OceanWaveMusic & {
  offlineArtworkUri?: string | null;
  offlineAudioUri: string;
};

export type OfflinePlaylist = {
  playlistId: number;
  playlistName: string;
  savedAt: string;
  serverId: string;
  serverName: string;
  serverUrl: string;
  tracks: OfflineMusic[];
};

export type SaveOfflinePlaylistProgress = {
  completed: number;
  total: number;
  trackName?: string;
};

type CachedServerPlaylists = Record<string, OceanWavePlaylist[]>;

function offlinePlaylistKey(serverUrl: string, playlistId: number) {
  return `${serverUrl}::${playlistId}`;
}

function audioFileName(serverUrl: string, playlistId: number, musicId: number) {
  return `${encodeURIComponent(serverUrl)}_${playlistId}_${musicId}.mp3`;
}

export async function readOfflinePlaylists() {
  const stored = await getStoredString(OFFLINE_PLAYLISTS_KEY);
  if (!stored) return [];

  try {
    return JSON.parse(stored) as OfflinePlaylist[];
  } catch {
    return [];
  }
}

async function writeOfflinePlaylists(playlists: OfflinePlaylist[]) {
  await setStoredString(OFFLINE_PLAYLISTS_KEY, JSON.stringify(playlists));
}

async function readCachedServerPlaylists() {
  const stored = await getStoredString(CACHED_PLAYLISTS_KEY);
  if (!stored) return {};

  try {
    const parsed = JSON.parse(stored) as CachedServerPlaylists;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function readCachedPlaylistsForServer(serverUrl: string) {
  const cache = await readCachedServerPlaylists();
  return cache[serverUrl] ?? [];
}

export async function writeCachedPlaylistsForServer(serverUrl: string, playlists: OceanWavePlaylist[]) {
  const cache = await readCachedServerPlaylists();
  await setStoredString(CACHED_PLAYLISTS_KEY, JSON.stringify({
    ...cache,
    [serverUrl]: playlists.map(playlist => ({
      id: playlist.id,
      name: playlist.name,
      musicCount: playlist.musicCount,
    })),
  }));
}

export function findOfflinePlaylist(playlists: OfflinePlaylist[], serverUrl: string, playlistId: number) {
  const key = offlinePlaylistKey(serverUrl, playlistId);
  return playlists.find(playlist => offlinePlaylistKey(playlist.serverUrl, playlist.playlistId) === key) ?? null;
}

export function listOfflinePlaylistsForServer(playlists: OfflinePlaylist[], serverUrl: string) {
  return playlists.filter(playlist => playlist.serverUrl === serverUrl);
}

export function hasOfflinePlaylistUpdate(offlinePlaylist: OfflinePlaylist | null | undefined, tracks: OceanWaveMusic[]) {
  if (!offlinePlaylist) return false;
  const offlineTrackIds = offlinePlaylist.tracks.map(track => track.id);
  const trackIds = tracks.map(track => track.id);

  if (offlineTrackIds.length !== trackIds.length) return true;

  return trackIds.some((trackId, index) => offlineTrackIds[index] !== trackId);
}

export async function saveOfflinePlaylist(
  profile: ServerProfile,
  playlistId: number,
  playlistName: string,
  tracks: OceanWaveMusic[],
  onProgress?: (progress: SaveOfflinePlaylistProgress) => void,
) {
  const current = await readOfflinePlaylists();
  const previousPlaylist = findOfflinePlaylist(current, profile.url, playlistId);
  const previousTracks = new Map(previousPlaylist?.tracks.map(track => [track.id, track]));
  const nextTrackIds = new Set(tracks.map(track => track.id));
  const total = tracks.length;
  const offlineTracks: OfflineMusic[] = [];

  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    onProgress?.({ completed: index, total, trackName: track.name });

    const previousTrack = previousTracks.get(track.id);
    const offlineAudioUri = previousTrack?.offlineAudioUri ?? await downloadRemoteFile(
      audioStreamUrl(profile.url, track.id),
      audioFileName(profile.url, playlistId, track.id),
      profile.sessionCookie,
    );
    const remoteArtworkUri = albumArtUrl(profile.url, track.album?.cover);
    const offlineArtworkUri = previousTrack?.offlineArtworkUri ?? await cacheRemoteImage(remoteArtworkUri, profile.sessionCookie);

    offlineTracks.push({
      ...track,
      offlineArtworkUri,
      offlineAudioUri,
    });
    onProgress?.({ completed: index + 1, total, trackName: track.name });
  }

  const nextPlaylist: OfflinePlaylist = {
    playlistId,
    playlistName,
    savedAt: new Date().toISOString(),
    serverId: profile.id,
    serverName: profile.name,
    serverUrl: profile.url,
    tracks: offlineTracks,
  };

  const next = [
    ...current.filter(playlist => offlinePlaylistKey(playlist.serverUrl, playlist.playlistId) !== offlinePlaylistKey(profile.url, playlistId)),
    nextPlaylist,
  ];
  await writeOfflinePlaylists(next);

  if (previousPlaylist) {
    await Promise.all(previousPlaylist.tracks
      .filter(track => !nextTrackIds.has(track.id))
      .map(track => deleteLocalFile(track.offlineAudioUri)));
  }

  return nextPlaylist;
}

export async function deleteOfflinePlaylist(serverUrl: string, playlistId: number) {
  const current = await readOfflinePlaylists();
  const target = findOfflinePlaylist(current, serverUrl, playlistId);
  if (target) {
    await Promise.all(target.tracks.map(track => deleteLocalFile(track.offlineAudioUri)));
  }

  const next = current.filter(playlist => offlinePlaylistKey(playlist.serverUrl, playlist.playlistId) !== offlinePlaylistKey(serverUrl, playlistId));
  await writeOfflinePlaylists(next);
  return next;
}
