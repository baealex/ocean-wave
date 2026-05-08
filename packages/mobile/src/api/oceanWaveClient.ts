export type OceanWaveAuthMode = 'open' | 'password';

export type OceanWaveAuthSession = {
  mode: OceanWaveAuthMode;
  authRequired: boolean;
  authenticated: boolean;
};

export type OceanWaveMusic = {
  id: number;
  name: string;
  duration?: number | null;
  isLiked?: boolean;
  createdAt?: string | null;
  artist?: { id: number; name: string } | null;
  album?: { id: number; name: string; cover?: string | null } | null;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

const libraryQuery = `
  query MobileLibrary {
    allMusics {
      id
      name
      duration
      isLiked
      createdAt
      artist { id name }
      album { id name cover }
    }
  }
`;

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

const withCookie = (cookie?: string | null): Record<string, string> => {
  return cookie ? { Cookie: cookie } : {};
};

export function extractSessionCookie(response: Response) {
  const rawCookie = response.headers.get('set-cookie');
  if (!rawCookie) return null;

  return rawCookie
    .split(',')
    .map(value => value.trim())
    .find(value => value.startsWith('ocean-wave.sid='))
    ?.split(';')[0] ?? null;
}

export function audioStreamUrl(serverUrl: string, musicId: number) {
  return `${normalizeServerUrl(serverUrl)}/api/audio/${musicId}?notranscode=true`;
}

export function albumArtUrl(serverUrl: string, cover?: string | null) {
  if (!cover) return undefined;
  if (/^https?:\/\//i.test(cover)) return cover;
  return `${normalizeServerUrl(serverUrl)}${cover.startsWith('/') ? '' : '/'}${cover}`;
}

export async function fetchAuthSession(serverUrl: string, sessionCookie?: string | null) {
  const endpoint = `${normalizeServerUrl(serverUrl)}/api/auth/session`;
  const response = await fetch(endpoint, {
    method: 'GET',
    credentials: 'omit',
    headers: withCookie(sessionCookie),
  });

  if (!response.ok) {
    throw new Error(`Session request failed (${response.status})`);
  }

  return (await response.json()) as OceanWaveAuthSession;
}

export async function loginWithPassword(serverUrl: string, password: string) {
  const endpoint = `${normalizeServerUrl(serverUrl)}/api/auth/login`;
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  const sessionCookie = extractSessionCookie(response);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = typeof payload?.message === 'string'
      ? payload.message
      : `Login request failed (${response.status})`;
    throw new Error(message);
  }

  return {
    session: payload as OceanWaveAuthSession,
    sessionCookie,
  };
}

export async function logoutSession(serverUrl: string, sessionCookie?: string | null) {
  const endpoint = `${normalizeServerUrl(serverUrl)}/api/auth/logout`;
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      ...withCookie(sessionCookie),
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Logout request failed (${response.status})`);
  }

  return (await response.json()) as OceanWaveAuthSession;
}

export async function fetchMobileLibrary(serverUrl: string, sessionCookie?: string | null) {
  const endpoint = `${normalizeServerUrl(serverUrl)}/graphql`;
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      ...withCookie(sessionCookie),
    },
    body: JSON.stringify({ query: libraryQuery }),
  });

  if (!response.ok) {
    throw new Error(`Library request failed (${response.status})`);
  }

  const payload = (await response.json()) as GraphQLResponse<{ allMusics: OceanWaveMusic[] }>;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map(error => error.message).join('\n'));
  }

  return payload.data?.allMusics ?? [];
}
