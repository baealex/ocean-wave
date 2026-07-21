import type {
    MusicMetadataArtistCreditInput,
    UpdateMusicMetadataInput
} from '~/api/music';
import type {
    ArtistCredit,
    ArtistCreditRole,
    Music,
    ReleaseType
} from '~/models/type';

export interface MusicMetadataCreditValue {
    name: string;
    role: ArtistCreditRole;
    creditedName: string;
    joinPhrase: string;
}

export interface MusicMetadataEditorValues {
    recordingTitle: string;
    titleOverride: string;
    recordingVersionTitle: string;
    recordingArtistCredits: MusicMetadataCreditValue[];
    useAppearanceCredits: boolean;
    releaseTrackArtistCredits: MusicMetadataCreditValue[];
    releaseTitle: string;
    releaseArtistCredits: MusicMetadataCreditValue[];
    releaseDate: string;
    releaseType: ReleaseType;
    totalDiscs: string;
    releaseVersionTitle: string;
    discNumber: string;
    trackNumber: string;
    genres: string;
}

export const musicNeedsMetadataRepair = (
    music: Pick<Music, 'files' | 'hasMetadataOverride'>
) => music.hasMetadataOverride || Boolean(
    music.files?.some(file => (
        file.syncStatus === 'active'
        && file.metadataSyncStatus !== 'current'
    ))
);

const toCreditValues = (
    credits: ArtistCredit[],
    fallbackName: string
): MusicMetadataCreditValue[] => {
    if (!credits.length) {
        return [{
            name: fallbackName,
            role: 'PRIMARY',
            creditedName: '',
            joinPhrase: ''
        }];
    }

    return credits.map(credit => ({
        name: credit.artist.name,
        role: credit.role,
        creditedName: credit.creditedName ?? '',
        joinPhrase: credit.joinPhrase
    }));
};

export const toMusicMetadataEditorValues = (
    music: Music
): MusicMetadataEditorValues => {
    const recordingCredits = toCreditValues(
        music.recordingArtistCredits ?? music.artistCredits,
        music.artist.name
    );
    const useAppearanceCredits = music.hasReleaseTrackArtistCredits ?? false;

    return {
        recordingTitle: music.recordingTitle ?? music.name,
        titleOverride: music.titleOverride ?? '',
        recordingVersionTitle: music.recordingVersionTitle ?? '',
        recordingArtistCredits: recordingCredits,
        useAppearanceCredits,
        releaseTrackArtistCredits: useAppearanceCredits
            ? toCreditValues(music.artistCredits, music.artist.name)
            : recordingCredits.map(credit => ({ ...credit })),
        releaseTitle: music.album.name,
        releaseArtistCredits: toCreditValues(
            music.album.artistCredits,
            music.album.artist.name
        ),
        releaseDate: music.album.publishedYear,
        releaseType: music.album.releaseType,
        totalDiscs: music.album.totalDiscs?.toString() ?? '',
        releaseVersionTitle: music.releaseVersionTitle ?? '',
        discNumber: music.discNumber?.toString() ?? '',
        trackNumber: music.trackNumber?.toString() ?? '',
        genres: music.genres.map(genre => genre.name).join(', ')
    };
};

const optionalPosition = (value: string, label: string) => {
    const trimmed = value.trim();

    if (!trimmed) return null;

    const parsed = Number(trimmed);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9999) {
        throw new Error(`${label} must be between 1 and 9999, or left blank.`);
    }

    return parsed;
};

const toCreditInput = (
    credits: MusicMetadataCreditValue[]
): MusicMetadataArtistCreditInput[] => credits.map(credit => ({
    name: credit.name,
    role: credit.role,
    creditedName: credit.creditedName.trim() || null,
    joinPhrase: credit.joinPhrase || null
}));

export const toUpdateMusicMetadataInput = (
    musicId: string,
    values: MusicMetadataEditorValues
): UpdateMusicMetadataInput => ({
    id: musicId,
    title: values.recordingTitle,
    titleOverride: values.titleOverride.trim() || null,
    recordingVersionTitle: values.recordingVersionTitle.trim() || null,
    recordingArtistCredits: toCreditInput(values.recordingArtistCredits),
    releaseTrackArtistCredits: values.useAppearanceCredits
        ? toCreditInput(values.releaseTrackArtistCredits)
        : null,
    album: values.releaseTitle,
    albumArtistCredits: toCreditInput(values.releaseArtistCredits),
    publishedYear: values.releaseDate,
    releaseType: values.releaseType,
    totalDiscs: optionalPosition(values.totalDiscs, 'Total discs'),
    releaseVersionTitle: values.releaseVersionTitle.trim() || null,
    discNumber: optionalPosition(values.discNumber, 'Disc number'),
    trackNumber: optionalPosition(values.trackNumber, 'Track number'),
    genres: values.genres.split(',').map(genre => genre.trim()).filter(Boolean)
});
