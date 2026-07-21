export interface Music {
    id: string;
    name: string;
    recordingTitle?: string;
    titleOverride?: string | null;
    duration: number;
    codec: string;
    bitrate: number;
    sampleRate: number;
    discNumber: number | null;
    trackNumber: number | null;
    recordingVersionTitle: string | null;
    releaseVersionTitle: string | null;
    playCount: number;
    lastPlayedAt: string | null;
    totalPlayedMs: number;
    skipCount: number;
    lastSkippedAt: string | null;
    completionCount: number;
    lastCompletedAt: string | null;
    filePath: string;
    files?: MusicFileVersion[];
    recordingAppearances?: Music[];
    groupingCandidates?: MusicGroupingCandidate[];
    hasMetadataOverride: boolean;
    isLiked: boolean;
    isHated: boolean;
    createdAt: number;
    artist: Artist;
    artistDisplayName: string;
    artistCredits: ArtistCredit[];
    recordingArtistCredits?: ArtistCredit[];
    hasReleaseTrackArtistCredits?: boolean;
    album: Album;
    genres: {
        name: string;
    }[];
    tags: Tag[];
}

export interface MusicFileVersion {
    id: string;
    filePath: string;
    codec: string;
    container: string;
    bitrate: number;
    sampleRate: number;
    duration: number;
    syncStatus: string;
    metadataSyncStatus: string;
    metadataSyncError: string | null;
    isPreferred: boolean;
    isSelected: boolean;
    isPlayable: boolean;
}

export interface MusicGroupingCandidate {
    kind: 'ALTERNATE_FILE' | 'SAME_RECORDING';
    music: Music;
    reasons: string[];
}

export type ArtistCreditRole =
    | 'PRIMARY'
    | 'FEATURED'
    | 'REMIXER'
    | 'PERFORMER'
    | 'COMPOSER'
    | 'CONDUCTOR'
    | 'UNKNOWN';

export interface ArtistCredit {
    artist: Pick<Artist, 'id' | 'name'>;
    role: ArtistCreditRole;
    position: number;
    creditedName: string | null;
    joinPhrase: string;
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
    releaseType: ReleaseType;
    totalDiscs: number | null;
    artistDisplayName: string;
    artistCredits: ArtistCredit[];
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
    appearsOn: Album[];
    appearsOnCount: number;
    musics: Pick<Music, 'id'>[];
    musicCount: number;
    createdAt: number;
}

export type ReleaseType =
    | 'ALBUM'
    | 'EP'
    | 'SINGLE'
    | 'COMPILATION'
    | 'LIVE'
    | 'UNKNOWN';

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
    kind: 'created' | 'moved' | 'duplicate' | 'missing' | 'reconcile';
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
    reconcileCount: number;
    created: SyncReportItem[];
    moved: SyncReportItem[];
    duplicate: SyncReportItem[];
    missing: SyncReportItem[];
    reconcile: SyncReportItem[];
}
