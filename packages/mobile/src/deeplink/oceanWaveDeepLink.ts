import { normalizeServerUrl } from '../api/oceanWaveClient';

export type OceanWaveDeepLinkTarget = 'music' | 'playlist';

export type OceanWaveDeepLinkRequest = {
  target: OceanWaveDeepLinkTarget;
  id: number;
  serverUrl?: string;
};

export function parseOceanWaveDeepLink(rawUrl: string): OceanWaveDeepLinkRequest | null {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'oceanwave:') return null;

  const segments = [url.hostname, ...url.pathname.split('/')]
    .map(segment => segment.trim())
    .filter(Boolean);

  const [action, target, rawId] = segments;
  if (action !== 'play') return null;
  if (target !== 'music' && target !== 'playlist') return null;

  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const server = url.searchParams.get('server');
  const serverUrl = server ? normalizeServerUrl(server) : undefined;

  return { target, id, serverUrl };
}
