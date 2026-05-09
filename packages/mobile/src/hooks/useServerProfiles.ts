import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  getBuiltInProfiles,
  LAST_PROFILE_ID_STORAGE_KEY,
  normalizeProfiles,
  readProfilesPayload,
  ServerProfile,
  SERVER_PROFILES_STORAGE_KEY,
} from '../app/serverProfiles';
import { normalizeServerUrl } from '../api/oceanWaveClient';
import { getStoredString, setStoredString } from '../storage/nativeKeyValue';

type UseServerProfilesOptions = {
  onDeleteSelected?: () => void;
};

export function useServerProfiles({ onDeleteSelected }: UseServerProfilesOptions = {}) {
  const [profiles, setProfiles] = useState<ServerProfile[]>(getBuiltInProfiles);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [hasLoadedSavedProfiles, setHasLoadedSavedProfiles] = useState(false);

  const selectedProfile = useMemo(() => profiles.find(profile => profile.id === selectedProfileId) ?? null, [profiles, selectedProfileId]);

  const persistProfiles = useCallback((nextProfiles: ServerProfile[]) => {
    setStoredString(SERVER_PROFILES_STORAGE_KEY, JSON.stringify(nextProfiles.filter(profile => !profile.isDemo))).catch(() => undefined);
  }, []);

  const persistLastProfileId = useCallback((profileId: string | null) => {
    if (!profileId) return;
    setStoredString(LAST_PROFILE_ID_STORAGE_KEY, profileId).catch(() => undefined);
  }, []);

  const selectProfile = useCallback((profileId: string | null) => {
    setSelectedProfileId(profileId);
    persistLastProfileId(profileId);
  }, [persistLastProfileId]);

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      getStoredString(SERVER_PROFILES_STORAGE_KEY),
      getStoredString(LAST_PROFILE_ID_STORAGE_KEY),
    ])
      .then(([profilesPayload, lastProfileId]) => {
        if (!isMounted) return;
        const nextProfiles = readProfilesPayload(profilesPayload);
        setProfiles(nextProfiles);
        if (lastProfileId && nextProfiles.some(profile => profile.id === lastProfileId)) {
          setSelectedProfileId(lastProfileId);
        }
        setHasLoadedSavedProfiles(true);
      })
      .catch(() => {
        if (!isMounted) return;
        setProfiles(getBuiltInProfiles());
        setHasLoadedSavedProfiles(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedSavedProfiles) return;
    persistProfiles(profiles);
  }, [hasLoadedSavedProfiles, persistProfiles, profiles]);

  const upsertProfile = useCallback(async (profile: ServerProfile) => {
    const normalizedProfile = { ...profile, url: normalizeServerUrl(profile.url) };
    setProfiles(currentProfiles => {
      const nextProfiles = normalizeProfiles(currentProfiles.some(item => item.id === normalizedProfile.id)
        ? currentProfiles.map(item => item.id === normalizedProfile.id ? normalizedProfile : item)
        : [normalizedProfile, ...currentProfiles]);
      persistProfiles(nextProfiles);
      persistLastProfileId(normalizedProfile.id);
      return nextProfiles;
    });
    return normalizedProfile;
  }, [persistLastProfileId, persistProfiles]);

  const deleteProfile = useCallback((profileId: string) => {
    setProfiles(currentProfiles => {
      const nextProfiles = normalizeProfiles(currentProfiles.filter(profile => profile.id !== profileId));
      persistProfiles(nextProfiles);
      return nextProfiles;
    });
    if (selectedProfileId === profileId) {
      setSelectedProfileId(null);
      onDeleteSelected?.();
    }
  }, [onDeleteSelected, persistProfiles, selectedProfileId]);

  return {
    deleteProfile,
    hasLoadedSavedProfiles,
    profiles,
    selectProfile,
    selectedProfile,
    selectedProfileId,
    setSelectedProfileId: selectProfile,
    upsertProfile,
  };
}
