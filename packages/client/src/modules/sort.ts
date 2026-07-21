export const sortByName = <T extends { name: string }>(items: T[]) => {
    return items.sort((a, b) => a.name.localeCompare(b.name));
};

export const sortByArtistName = <T extends { artistDisplayName: string }>(items: T[]) => {
    return items.sort((a, b) => a.artistDisplayName.localeCompare(b.artistDisplayName));
};

export const sortByAlbumName = <T extends { album: { name: string } }>(items: T[]) => {
    return items.sort((a, b) => a.album.name.localeCompare(b.album.name));
};

export const sortByPlayCount = <T extends { playCount: number }>(items: T[]) => {
    return items.sort((a, b) => b.playCount - a.playCount);
};

export const sortByCreatedAt = <T extends { createdAt: number }>(items: T[]) => {
    return items.sort((a, b) => b.createdAt - a.createdAt);
};

export const sortByPublishedYear = <T extends { publishedYear: string }>(items: T[]) => {
    return items.sort((a, b) => b.publishedYear.localeCompare(a.publishedYear));
};

export const sortByAlbumCount = <T extends { albumCount: number }>(items: T[]) => {
    return items.sort((a, b) => b.albumCount - a.albumCount);
};

export const sortByMusicCount = <T extends { musicCount: number }>(items: T[]) => {
    return items.sort((a, b) => b.musicCount - a.musicCount);
};

export const sortByDuration = <T extends { duration: number }>(items: T[]) => {
    return items.sort((a, b) => a.duration - b.duration);
};
