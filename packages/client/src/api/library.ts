import type {
    Album,
    Artist,
    Music,
    Playlist
} from '~/models/type';

import { createQuery, graphQLRequest, wrapper } from './graphql';

const artistCreditFields = [
    'role',
    'position',
    'creditedName',
    'joinPhrase',
    createQuery<Artist>('artist', ['id', 'name'])
];

export function getMusics() {
    return graphQLRequest<'allMusics', Music[]>({
        operationName: 'AllMusics',
        query: wrapper('query AllMusics', (createQuery<Music>('allMusics', [
            'id',
            'name',
            'filePath',
            'hasMetadataOverride',
            'codec',
            'duration',
            'playCount',
            'lastPlayedAt',
            'totalPlayedMs',
            'skipCount',
            'lastSkippedAt',
            'completionCount',
            'lastCompletedAt',
            'trackNumber',
            'isLiked',
            'isHated',
            'createdAt',
            'artistDisplayName',
            createQuery('artistCredits', artistCreditFields),
            createQuery<Artist>('artist', [
                'id',
                'name'
            ]),
            createQuery<Album>('album', [
                'id',
                'name',
                'cover',
                'isCoverCustom',
                'publishedYear'
            ]),
            createQuery('tags', [
                'id',
                'scopeKey',
                'name',
                'normalizedName',
                'color',
                'description',
                'order',
                'musicCount',
                'smartViewCount',
                'createdAt',
                'updatedAt'
            ])
        ])))
    });
}

export function getMusic(id: string) {
    return graphQLRequest<'music', Music, { id: string }>({
        operationName: 'Music',
        variables: { id },
        query: wrapper('query Music($id: ID!)', createQuery<Music>('music(id: $id)', [
            'id',
            'name',
            'filePath',
            'codec',
            'bitrate',
            'sampleRate',
            'duration',
            'trackNumber',
            'hasMetadataOverride',
            'artistDisplayName',
            createQuery('artistCredits', artistCreditFields),
            createQuery<Artist>('artist', [
                'id',
                'name'
            ]),
            createQuery<Album>('album', [
                'id',
                'name',
                'cover',
                'isCoverCustom',
                'publishedYear',
                'artistDisplayName',
                createQuery('artistCredits', artistCreditFields),
                createQuery<Artist>('artist', [
                    'id',
                    'name'
                ])
            ]),
            createQuery('genres', [
                'name'
            ])
        ]))
    });
}

export function getArtists() {
    return graphQLRequest<'allArtists', Artist[]>({
        operationName: 'AllArtists',
        query: wrapper('query AllArtists', createQuery<Artist>('allArtists', [
            'id',
            'name',
            'createdAt',
            'albumCount',
            'musicCount',
            createQuery<Album>('latestAlbum', [
                'cover'
            ])
        ]))
    });
}

export function getArtist(id: string) {
    return graphQLRequest<'artist', Artist, { id: string }>({
        operationName: 'Artist',
        variables: { id },
        query: wrapper('query Artist($id: ID!)', createQuery<Artist>('artist(id: $id)', [
            'id',
            'name',
            'albumCount',
            'musicCount',
            'createdAt',
            createQuery<Album>('latestAlbum', [
                'cover'
            ]),
            createQuery<Album>('albums', [
                'id',
                'name',
                'cover',
                'publishedYear',
                'artistDisplayName',
                createQuery('artistCredits', artistCreditFields)
            ]),
            createQuery<Music>('musics', [
                'id'
            ])
        ]))
    });
}

export function getAlbums() {
    return graphQLRequest<'allAlbums', Album[]>({
        operationName: 'AllAlbums',
        query: wrapper('query AllAlbums', createQuery<Album>('allAlbums', [
            'id',
            'name',
            'cover',
            'isCoverCustom',
            'publishedYear',
            'createdAt',
            'artistDisplayName',
            createQuery('artistCredits', artistCreditFields),
            createQuery<Artist>('artist', [
                'id',
                'name'
            ])
        ]))
    });
}

export function getAlbum(id: string) {
    return graphQLRequest<'album', Album, { id: string }>({
        operationName: 'Album',
        variables: { id },
        query: wrapper('query Album($id: ID!)', createQuery<Album>('album(id: $id)', [
            'id',
            'name',
            'cover',
            'isCoverCustom',
            'publishedYear',
            'artistDisplayName',
            createQuery('artistCredits', artistCreditFields),
            createQuery<Artist>('artist', [
                'id',
                'name'
            ]),
            createQuery<Music>('musics', [
                'id'
            ])
        ]))
    });
}

export function getPlaylists() {
    return graphQLRequest<'allPlaylist', Playlist[]>({
        operationName: 'AllPlaylists',
        query: wrapper('query AllPlaylists', createQuery<Playlist>('allPlaylist', [
            'id',
            'name',
            'musicCount',
            'createdAt',
            'updatedAt',
            createQuery<Music>('headerMusics', [
                'id'
            ])
        ]))
    });
}

export function getPlaylist(id: string) {
    return graphQLRequest<'playlist', Playlist, { id: string }>({
        operationName: 'Playlist',
        variables: { id },
        query: wrapper('query Playlist($id: ID!)', createQuery<Playlist>('playlist(id: $id)', [
            'id',
            'name',
            'musicCount',
            'createdAt',
            'updatedAt',
            createQuery<Music>('musics', [
                'id'
            ])
        ]))
    });
}
