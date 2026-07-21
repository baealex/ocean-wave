import { graphQuery } from './graphql';

export type LibraryRediscoveryReasonCode =
    | 'RECENTLY_ADDED'
    | 'LIKED_NOT_RECENTLY_PLAYED'
    | 'NEVER_PLAYED'
    | 'RARELY_PLAYED'
    | 'FORGOTTEN_ALBUM'
    | 'FREQUENTLY_COMPLETED'
    | 'TAG_AFFINITY'
    | 'GENRE_AFFINITY'
    | 'LIBRARY_FALLBACK';

export interface LibraryRediscoveryTrackCandidate {
    musicId: string;
    score: number;
    reasonCodes: LibraryRediscoveryReasonCode[];
}

export interface LibraryRediscoveryAlbumCandidate {
    albumId: string;
    representativeMusicId: string;
    trackCount: number;
    lastPlayedAt: string | null;
    score: number;
    reasonCodes: LibraryRediscoveryReasonCode[];
}

export interface LibraryRediscovery {
    generatedAt: string;
    eligibleMusicCount: number;
    recentlyAdded: LibraryRediscoveryTrackCandidate[];
    dormantLiked: LibraryRediscoveryTrackCandidate[];
    underplayed: LibraryRediscoveryTrackCandidate[];
    forgottenAlbums: LibraryRediscoveryAlbumCandidate[];
    fallback: LibraryRediscoveryTrackCandidate[];
}

export const getLibraryRediscovery = (limit = 8) => graphQuery<{
    libraryRediscovery: LibraryRediscovery;
}, { limit: number }>({
    operationName: 'LibraryRediscovery',
    query: `query LibraryRediscovery($limit: Int) {
        libraryRediscovery(limit: $limit) {
            generatedAt
            eligibleMusicCount
            recentlyAdded { musicId score reasonCodes }
            dormantLiked { musicId score reasonCodes }
            underplayed { musicId score reasonCodes }
            forgottenAlbums {
                albumId
                representativeMusicId
                trackCount
                lastPlayedAt
                score
                reasonCodes
            }
            fallback { musicId score reasonCodes }
        }
    }`,
    variables: { limit }
});
