export const queryKeys = {
    auth: {
        session: () => ['auth', { scope: 'session' }] as const
    },
    albums: {
        all: () => ['albums'] as const,
        detail: (id?: string) => ['album', { id }] as const
    },
    artists: {
        all: () => ['artists'] as const,
        detail: (id?: string) => ['artist', { id }] as const
    },
    playlists: {
        all: () => ['playlists'] as const,
        detail: (id?: string) => ['playlist', { id }] as const
    },
    syncReports: {
        listAll: () => ['sync-report'] as const,
        latest: () => ['sync-report', { scope: 'latest' }] as const
    },
    tags: {
        all: () => ['tags'] as const,
        list: ({
            query = '',
            limit = 100,
            offset = 0
        }: {
            query?: string;
            limit?: number;
            offset?: number;
        } = {}) => ['tags', {
            scope: 'list',
            query,
            limit,
            offset
        }] as const
    }
};
