import { NativeModules } from 'react-native';

import { normalizeServerUrl, OceanWaveAuthSession } from '../api/oceanWaveClient';

export const DEFAULT_SERVER_PORT = '44100';
export const DEMO_SERVER_URL = 'https://demo-ocean-wave.baejino.com';
export const SERVER_PROFILES_STORAGE_KEY = 'ocean-wave.serverProfiles.v1';
export const LAST_PROFILE_ID_STORAGE_KEY = 'ocean-wave.lastProfileId.v1';

export type ServerProfile = {
  id: string;
  name: string;
  url: string;
  sessionCookie?: string | null;
  authSession?: OceanWaveAuthSession | null;
  isDemo?: boolean;
};

export function getBundlerServerUrl() {
  const scriptUrl = NativeModules.SourceCode?.scriptURL;
  if (typeof scriptUrl !== 'string') return '';

  const host = scriptUrl.match(/^[a-z]+:\/\/([^:/]+)/i)?.[1];
  return host ? `http://${host}:${DEFAULT_SERVER_PORT}` : '';
}

export function createProfile(name: string, url: string, partial: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: partial.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: name.trim() || 'Ocean Wave Server',
    url: normalizeServerUrl(url),
    sessionCookie: partial.sessionCookie ?? null,
    authSession: partial.authSession ?? null,
    isDemo: partial.isDemo,
  };
}

export function getBuiltInProfiles() {
  const localDemoUrl = getBundlerServerUrl();
  const profiles = [createProfile('Demo Ocean Wave', DEMO_SERVER_URL, { id: 'demo-ocean-wave', isDemo: true })];
  if (localDemoUrl && localDemoUrl !== DEMO_SERVER_URL) {
    profiles.push(createProfile('Local Demo', localDemoUrl, { id: 'local-demo', isDemo: true }));
  }
  return profiles;
}

export function normalizeProfiles(profiles: ServerProfile[]) {
  const builtIns = getBuiltInProfiles();
  const byId = new Map<string, ServerProfile>();

  for (const profile of builtIns) {
    byId.set(profile.id, profile);
  }

  for (const profile of profiles) {
    if (!profile?.id || !profile.url) continue;
    if (profile.isDemo) continue;
    byId.set(profile.id, {
      id: profile.id,
      name: profile.name?.trim() || 'Ocean Wave Server',
      url: normalizeServerUrl(profile.url),
      sessionCookie: profile.sessionCookie ?? null,
      authSession: profile.authSession ?? null,
      isDemo: false,
    });
  }

  return Array.from(byId.values());
}

export function readProfilesPayload(payload: string | null) {
  if (!payload) return getBuiltInProfiles();

  try {
    const parsed = JSON.parse(payload) as ServerProfile[];
    return normalizeProfiles(Array.isArray(parsed) ? parsed : []);
  } catch {
    return getBuiltInProfiles();
  }
}
