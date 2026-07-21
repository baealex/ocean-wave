import type { Album, Music, ReleaseType } from '~/models/type';

export const RELEASE_TYPE_OPTIONS: Array<{ value: ReleaseType; label: string }> = [
    { value: 'ALBUM', label: 'Album' },
    { value: 'EP', label: 'EP' },
    { value: 'SINGLE', label: 'Single' },
    { value: 'COMPILATION', label: 'Compilation' },
    { value: 'LIVE', label: 'Live' },
    { value: 'UNKNOWN', label: 'Unknown type' }
];

const releaseTypeLabels = new Map(
    RELEASE_TYPE_OPTIONS.map(option => [option.value, option.label])
);

export const getReleaseTypeLabel = (releaseType: ReleaseType) => {
    return releaseTypeLabels.get(releaseType) ?? 'Unknown type';
};

export const resolveReleaseTypeFilter = (value: string | null): ReleaseType | '' => {
    return RELEASE_TYPE_OPTIONS.some(option => option.value === value)
        ? value as ReleaseType
        : '';
};

export const filterAlbumsByRelease = ({
    albums,
    query,
    releaseType
}: {
    albums: Album[];
    query: string;
    releaseType: ReleaseType | '';
}) => {
    const normalizedQuery = query.trim().toLowerCase();

    return albums.filter(album => (
        (!releaseType || album.releaseType === releaseType)
        && (!normalizedQuery || [
            album.name,
            album.artistDisplayName,
            getReleaseTypeLabel(album.releaseType)
        ].some(value => value.toLowerCase().includes(normalizedQuery)))
    ));
};

export interface DiscGroup<T> {
    discNumber: number | null;
    tracks: T[];
}

const compareNullableNumber = (left: number | null, right: number | null) => {
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
};

export const groupTracksByDisc = <T extends Pick<
Music,
'id' | 'discNumber' | 'trackNumber'
>>(tracks: T[]): DiscGroup<T>[] => {
    const orderedTracks = [...tracks].sort((left, right) => (
        compareNullableNumber(left.discNumber, right.discNumber)
        || compareNullableNumber(left.trackNumber, right.trackNumber)
        || Number(left.id) - Number(right.id)
    ));
    const groups = new Map<number | null, T[]>();

    for (const track of orderedTracks) {
        const group = groups.get(track.discNumber) ?? [];
        group.push(track);
        groups.set(track.discNumber, group);
    }

    return [...groups].map(([discNumber, groupedTracks]) => ({
        discNumber,
        tracks: groupedTracks
    }));
};

export const shouldShowDiscHeadings = (
    groups: DiscGroup<unknown>[],
    totalDiscs: number | null
) => {
    return groups.length > 1
        || (totalDiscs ?? 0) > 1
        || groups.some(group => group.discNumber !== null && group.discNumber !== 1);
};

export const getDiscLabel = (discNumber: number | null) => {
    return discNumber === null ? 'Unknown disc' : `Disc ${discNumber}`;
};
