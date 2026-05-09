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


export type OceanWavePlaylist = {
  id: number;
  name: string;
  musicCount: number;
  musics?: OceanWaveMusic[];
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

const NETWORK_TIMEOUT_MS = 10_000;
const NETWORK_RETRY_DELAY_MS = 600;

type FetchOptions = RequestInit & { retry?: boolean };

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(() => resolve(), ms));
}

function createNetworkError(error: unknown, endpoint: string) {
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error(`Server response timed out. Check that both devices are on the same Wi-Fi. (${endpoint})`);
  }

  return new Error(error instanceof Error
    ? `Unable to reach the server. Check the Wi-Fi network or server URL. (${error.message})`
    : 'Unable to reach the server. Check the Wi-Fi network or server URL.');
}

async function fetchWithTimeout(endpoint: string, options: FetchOptions = {}) {
  const { retry = true, ...fetchOptions } = options;
  const attempts = retry ? 2 : 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        ...fetchOptions,
        signal: controller.signal,
      });

      if (response.status >= 500 && attempt + 1 < attempts) {
        await sleep(NETWORK_RETRY_DELAY_MS);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) {
        throw createNetworkError(error, endpoint);
      }
      await sleep(NETWORK_RETRY_DELAY_MS);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw createNetworkError(lastError, endpoint);
}


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



const musicQuery = `
  query MobileMusic($id: ID!) {
    music(id: $id) {
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

const playlistsQuery = `
  query MobilePlaylists {
    allPlaylist {
      id
      name
      musicCount
    }
  }
`;

const playlistDetailQuery = `
  query MobilePlaylist($id: ID!) {
    playlist(id: $id) {
      id
      name
      musicCount
      musics {
        id
        name
        duration
        isLiked
        createdAt
        artist { id name }
        album { id name cover }
      }
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
  if (!cover) return `${normalizeServerUrl(serverUrl)}/default-artwork.jpg`;
  if (/^https?:\/\//i.test(cover)) return cover;
  return `${normalizeServerUrl(serverUrl)}${cover.startsWith('/') ? '' : '/'}${cover}`;
}

export async function fetchAuthSession(serverUrl: string, sessionCookie?: string | null) {
  const endpoint = `${normalizeServerUrl(serverUrl)}/api/auth/session`;
  const response = await fetchWithTimeout(endpoint, {
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
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    credentials: 'omit',
    retry: false,
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
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    credentials: 'omit',
    retry: false,
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



export async function fetchMobileMusic(serverUrl: string, musicId: number, sessionCookie?: string | null) {
  const endpoint = `${normalizeServerUrl(serverUrl)}/graphql`;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      ...withCookie(sessionCookie),
    },
    body: JSON.stringify({ query: musicQuery, variables: { id: String(musicId) } }),
  });

  if (!response.ok) {
    throw new Error(`Music request failed (${response.status})`);
  }

  const payload = (await response.json()) as GraphQLResponse<{ music: OceanWaveMusic | null }>;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map(error => error.message).join('\n'));
  }

  return payload.data?.music ?? null;
}

export async function fetchMobilePlaylists(serverUrl: string, sessionCookie?: string | null) {
  const endpoint = `${normalizeServerUrl(serverUrl)}/graphql`;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      ...withCookie(sessionCookie),
    },
    body: JSON.stringify({ query: playlistsQuery }),
  });

  if (!response.ok) {
    throw new Error(`Playlist request failed (${response.status})`);
  }

  const payload = (await response.json()) as GraphQLResponse<{ allPlaylist: OceanWavePlaylist[] }>;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map(error => error.message).join('\n'));
  }

  return payload.data?.allPlaylist ?? [];
}

export async function fetchMobilePlaylist(serverUrl: string, playlistId: number, sessionCookie?: string | null) {
  const endpoint = `${normalizeServerUrl(serverUrl)}/graphql`;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      ...withCookie(sessionCookie),
    },
    body: JSON.stringify({ query: playlistDetailQuery, variables: { id: String(playlistId) } }),
  });

  if (!response.ok) {
    throw new Error(`Playlist detail request failed (${response.status})`);
  }

  const payload = (await response.json()) as GraphQLResponse<{ playlist: OceanWavePlaylist | null }>;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map(error => error.message).join('\n'));
  }

  return payload.data?.playlist ?? null;
}

export async function fetchMobileLibrary(serverUrl: string, sessionCookie?: string | null) {
  const endpoint = `${normalizeServerUrl(serverUrl)}/graphql`;
  const response = await fetchWithTimeout(endpoint, {
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
