import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';

import {
  fetchAuthSession,
  fetchMobileMusic,
  fetchMobilePlaylist,
  normalizeServerUrl,
  OceanWaveMusic,
} from '../api/oceanWaveClient';
import { createProfile, ServerProfile } from '../app/serverProfiles';
import { parseOceanWaveDeepLink, type OceanWaveDeepLinkRequest } from '../deeplink/oceanWaveDeepLink';
import { playLibraryFrom } from '../player/trackPlayer';
import { MobileScreen } from './usePlaylistLibrary';

type UseOceanWaveDeepLinksOptions = {
  normalizedServerUrl: string;
  profiles: ServerProfile[];
  setLibrary: (value: OceanWaveMusic[]) => void;
  setMessage: (value: string) => void;
  setPlaylists: (value: []) => void;
  setScreen: (value: MobileScreen) => void;
  setSelectedPlaylistId: (value: number | null) => void;
  setSelectedPlaylistName: (value: string | null) => void;
  setSelectedProfileId: (value: string | null) => void;
  setServerName: (value: string) => void;
  setServerUrl: (value: string) => void;
  upsertProfile: (profile: ServerProfile) => Promise<ServerProfile>;
};

export function useOceanWaveDeepLinks({
  normalizedServerUrl,
  profiles,
  setLibrary,
  setMessage,
  setPlaylists,
  setScreen,
  setSelectedPlaylistId,
  setSelectedPlaylistName,
  setSelectedProfileId,
  setServerName,
  setServerUrl,
  upsertProfile,
}: UseOceanWaveDeepLinksOptions) {
  const [pendingDeepLink, setPendingDeepLink] = useState<OceanWaveDeepLinkRequest | null>(null);
  const handleDeepLinkUrlRef = useRef<(url: string | null) => void>(() => undefined);

  const runDeepLink = useCallback(async (request: OceanWaveDeepLinkRequest) => {
    setPendingDeepLink(null);
    const requestServerUrl = normalizeServerUrl(request.serverUrl ?? normalizedServerUrl);
    const profile = profiles.find(item => item.url === requestServerUrl) ?? createProfile('Shared Server', requestServerUrl);
    const savedProfile = await upsertProfile(profile);
    setSelectedProfileId(savedProfile.id);

    try {
      const session = await fetchAuthSession(savedProfile.url, savedProfile.sessionCookie);
      const authedProfile = await upsertProfile({ ...savedProfile, authSession: session });
      if (session.authRequired && !session.authenticated) {
        setServerName(authedProfile.name);
        setServerUrl(authedProfile.url);
        setScreen('addServer');
        setMessage('Password required for this shared server.');
        return;
      }

      if (request.target === 'music') {
        const music = await fetchMobileMusic(authedProfile.url, request.id, authedProfile.sessionCookie);
        if (!music) {
          setMessage('Requested track not found.');
          return;
        }
        setLibrary([music]);
        setPlaylists([]);
        setSelectedPlaylistId(null);
        setSelectedPlaylistName(null);
        setScreen('player');
        await playLibraryFrom(authedProfile.url, [music], 0, authedProfile.sessionCookie);
        setMessage(`${music.name} playback started.`);
        return;
      }

      const playlist = await fetchMobilePlaylist(authedProfile.url, request.id, authedProfile.sessionCookie);
      const nextMusics = playlist?.musics ?? [];
      if (!playlist || nextMusics.length === 0) {
        setMessage('Requested playlist was not found or is empty.');
        return;
      }

      setLibrary(nextMusics);
      setSelectedPlaylistId(playlist.id);
      setSelectedPlaylistName(playlist.name);
      setScreen('player');
      await playLibraryFrom(authedProfile.url, nextMusics, 0, authedProfile.sessionCookie);
      setMessage(`${playlist.name} playlist playback started.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [
    normalizedServerUrl,
    profiles,
    setLibrary,
    setMessage,
    setPlaylists,
    setScreen,
    setSelectedPlaylistId,
    setSelectedPlaylistName,
    setSelectedProfileId,
    setServerName,
    setServerUrl,
    upsertProfile,
  ]);

  const handleDeepLinkUrl = useCallback((url: string | null) => {
    if (!url) return;
    const request = parseOceanWaveDeepLink(url);
    if (!request) return;
    setPendingDeepLink(request);
  }, []);

  useEffect(() => {
    handleDeepLinkUrlRef.current = handleDeepLinkUrl;
  }, [handleDeepLinkUrl]);

  useEffect(() => {
    Linking.getInitialURL()
      .then(url => handleDeepLinkUrlRef.current(url))
      .catch(error => setMessage(error instanceof Error ? error.message : String(error)));

    const subscription = Linking.addEventListener('url', event => handleDeepLinkUrlRef.current(event.url));
    return () => subscription.remove();
  }, [setMessage]);

  useEffect(() => {
    if (!pendingDeepLink) return;
    runDeepLink(pendingDeepLink).catch(error => setMessage(error instanceof Error ? error.message : String(error)));
  }, [pendingDeepLink, runDeepLink, setMessage]);
}
