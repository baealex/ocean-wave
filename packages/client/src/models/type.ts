export interface Music {
    id: string;
    name: string;
    duration: number;
    codec: string;
    bitrate: number;
    sampleRate: number;
    trackNumber: number;
    playCount: number;
    lastPlayedAt: string | null;
    totalPlayedMs: number;
    skipCount: number;
    lastSkippedAt: string | null;
    completionCount: number;
    lastCompletedAt: string | null;
    filePath: string;
    hasMetadataOverride: boolean;
    isLiked: boolean;
    isHated: boolean;
    createdAt: number;
    artist: Artist;
    album: Album;
    genres: {
        name: string;
    }[];
    tags: Tag[];
}

export interface Tag {
    id: string;
    scopeKey: string;
    name: string;
    normalizedName: string;
    color: string | null;
    description: string | null;
    order: number;
    musicCount: number;
    smartViewCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface SmartView {
    id: string;
    scopeKey: string;
    name: string;
    normalizedName: string;
    tagMode: 'all' | 'any';
    sortKey: string | null;
    tags: Tag[];
    tagIds: string[];
    createdAt: string;
    updatedAt: string;
}

export interface Album {
    id: string;
    name: string;
    cover: string;
    isCoverCustom: boolean;
    publishedYear: string;
    artist: {
        id: string;
        name: string;
    };
    musics: Pick<Music, 'id'>[];
    createdAt: number;
}

export interface Artist {
    id: string;
    name: string;
    latestAlbum?: Album;
    albums: Album[];
    albumCount: number;
    musics: Pick<Music, 'id'>[];
    musicCount: number;
    createdAt: number;
}

export interface Playlist {
    id: string;
    name: string;
    musics: Pick<Music, 'id'>[];
    musicCount: number;
    headerMusics: Pick<Music, 'id'>[];
    createdAt: string;
    updatedAt: string;
}

export interface SyncReportItem {
    id: string;
    kind: 'created' | 'moved' | 'duplicate' | 'missing';
    musicId: string | null;
    musicName: string;
    filePath: string;
    previousFilePath: string | null;
    createdAt: string;
}

export interface SyncReport {
    id: string;
    createdAt: string;
    startedAt: string;
    completedAt: string | null;
    status: 'success' | 'error';
    force: boolean;
    scannedFiles: number;
    indexedFiles: number;
    createdCount: number;
    movedCount: number;
    duplicateCount: number;
    missingCount: number;
    created: SyncReportItem[];
    moved: SyncReportItem[];
    duplicate: SyncReportItem[];
    missing: SyncReportItem[];
}
