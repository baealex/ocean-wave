export type OceanWaveMusic = {
  id: number;
  name: string;
  duration?: number | null;
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

export function audioStreamUrl(serverUrl: string, musicId: number) {
  return `${normalizeServerUrl(serverUrl)}/api/audio/${musicId}?notranscode=true`;
}

export function albumArtUrl(serverUrl: string, cover?: string | null) {
  if (!cover) return undefined;
  if (/^https?:\/\//i.test(cover)) return cover;
  return `${normalizeServerUrl(serverUrl)}${cover.startsWith('/') ? '' : '/'}${cover}`;
}

export async function fetchMobileLibrary(serverUrl: string) {
  const endpoint = `${normalizeServerUrl(serverUrl)}/graphql`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
