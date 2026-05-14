export const mobileQueryKeys = {
  auth: {
    session: (serverUrl: string) => ['mobile', 'auth', 'session', { serverUrl }] as const,
  },
  playlists: {
    detail: (serverUrl: string, playlistId: number, authenticated: boolean) => ['mobile', 'playlists', 'detail', { authenticated, playlistId, serverUrl }] as const,
    list: (serverUrl: string, authenticated: boolean) => ['mobile', 'playlists', 'list', { authenticated, serverUrl }] as const,
  },
};
