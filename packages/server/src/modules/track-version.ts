import type { ICommonTagsResult } from 'music-metadata';

export const TRACK_TAG_SNAPSHOT_VERSION = 1;

export type TrackIdentifierScheme = 'musicbrainz-recording' | 'isrc' | 'acoustid';

export interface TrackIdentifier {
    scheme: TrackIdentifierScheme;
    value: string;
}

export interface TrackVersionMetadata {
    recordingVersionTitle: string | null;
    releaseVersionTitle: string | null;
}

export interface TrackTagSnapshot {
    version: typeof TRACK_TAG_SNAPSHOT_VERSION;
    identifiers: TrackIdentifier[];
    recordingVersionTitle: string | null;
    releaseVersionTitle: string | null;
}

const INTRINSIC_VERSION_PATTERN = /\b(live|acoustic|remix(?:ed)?|radio\s+edit|edit|demo|instrumental|karaoke|session|extended\s+mix)\b/i;
const RELEASE_VERSION_PATTERN = /\b(remaster(?:ed)?|mastered|mono|stereo|anniversary|deluxe)\b/i;
const TITLE_VERSION_SUFFIX_PATTERN = /^(.*?)\s*[([]\s*([^\])]+?)\s*[)\]]\s*$/;

export const normalizeVersionLabel = (value: string | null | undefined) => {
    if (!value) return null;

    const normalized = value
        .normalize('NFKC')
        .trim()
        .replace(/^[(\[]\s*|\s*[)\]]$/g, '')
        .replace(/\s+/g, ' ');

    return normalized || null;
};

const classifyVersionLabel = (value: string): keyof TrackVersionMetadata | null => {
    if (INTRINSIC_VERSION_PATTERN.test(value)) return 'recordingVersionTitle';
    if (RELEASE_VERSION_PATTERN.test(value)) return 'releaseVersionTitle';
    return null;
};

export const extractTitleVersionLabel = (title: string) => {
    const match = title.normalize('NFKC').trim().match(TITLE_VERSION_SUFFIX_PATTERN);

    if (!match) return null;

    const label = normalizeVersionLabel(match[2]);
    const scope = label ? classifyVersionLabel(label) : null;

    if (!label || !scope) return null;

    return {
        baseTitle: match[1].trim(),
        label,
        scope
    };
};

export const resolveTrackVersionMetadata = ({
    title,
    subtitles,
    remixers
}: {
    title: string;
    subtitles?: string[];
    remixers?: string[];
}): TrackVersionMetadata => {
    const subtitle = normalizeVersionLabel(subtitles?.filter(Boolean).join(' / '));
    const titleVersion = extractTitleVersionLabel(title);
    const label = subtitle ?? titleVersion?.label ?? (remixers?.length ? 'Remix' : null);

    if (!label) {
        return {
            recordingVersionTitle: null,
            releaseVersionTitle: null
        };
    }

    const scope = classifyVersionLabel(label)
        ?? titleVersion?.scope
        ?? 'recordingVersionTitle';

    return {
        recordingVersionTitle: scope === 'recordingVersionTitle' ? label : null,
        releaseVersionTitle: scope === 'releaseVersionTitle' ? label : null
    };
};

const normalizeIdentifier = (scheme: TrackIdentifierScheme, value: string) => {
    const normalized = value.normalize('NFKC').trim();

    if (!normalized) return null;

    if (scheme === 'isrc') {
        const isrc = normalized.replace(/[\s-]+/g, '').toUpperCase();
        return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) ? isrc : null;
    }

    return normalized.toLowerCase();
};

export const parseTrackIdentifiers = (common: Pick<
ICommonTagsResult,
'musicbrainz_recordingid' | 'isrc' | 'acoustid_id'
>): TrackIdentifier[] => {
    const values: Array<readonly [TrackIdentifierScheme, string | undefined]> = [
        ['musicbrainz-recording', common.musicbrainz_recordingid],
        ...((common.isrc ?? []).map(value => ['isrc', value] as const)),
        ['acoustid', common.acoustid_id]
    ];
    const seen = new Set<string>();

    return values.flatMap(([scheme, rawValue]) => {
        if (!rawValue) return [];

        const value = normalizeIdentifier(scheme, rawValue);
        const key = `${scheme}:${value}`;

        if (!value || seen.has(key)) return [];

        seen.add(key);
        return [{ scheme, value }];
    });
};

export const serializeTrackTagSnapshot = ({
    identifiers,
    recordingVersionTitle,
    releaseVersionTitle
}: Omit<TrackTagSnapshot, 'version'>) => JSON.stringify({
    version: TRACK_TAG_SNAPSHOT_VERSION,
    identifiers,
    recordingVersionTitle,
    releaseVersionTitle
} satisfies TrackTagSnapshot);

export const parseTrackTagSnapshot = (
    serialized: string | null | undefined
): TrackTagSnapshot | null => {
    if (!serialized) return null;

    try {
        const value = JSON.parse(serialized) as Partial<TrackTagSnapshot>;

        if (value.version !== TRACK_TAG_SNAPSHOT_VERSION || !Array.isArray(value.identifiers)) {
            return null;
        }

        const identifiers = value.identifiers.flatMap((identifier) => {
            if (!identifier || typeof identifier.scheme !== 'string' || typeof identifier.value !== 'string') {
                return [];
            }

            if (!['musicbrainz-recording', 'isrc', 'acoustid'].includes(identifier.scheme)) {
                return [];
            }

            const scheme = identifier.scheme as TrackIdentifierScheme;
            const normalized = normalizeIdentifier(scheme, identifier.value);
            return normalized ? [{ scheme, value: normalized }] : [];
        });

        return {
            version: TRACK_TAG_SNAPSHOT_VERSION,
            identifiers,
            recordingVersionTitle: normalizeVersionLabel(value.recordingVersionTitle),
            releaseVersionTitle: normalizeVersionLabel(value.releaseVersionTitle)
        };
    } catch {
        return null;
    }
};

export const getEffectiveVersionMetadata = ({
    title,
    recordingVersionTitle,
    releaseVersionTitle
}: {
    title: string;
    recordingVersionTitle: string | null;
    releaseVersionTitle: string | null;
}): TrackVersionMetadata => {
    const inferred = extractTitleVersionLabel(title);

    return {
        recordingVersionTitle: normalizeVersionLabel(recordingVersionTitle)
            ?? (inferred?.scope === 'recordingVersionTitle' ? inferred.label : null),
        releaseVersionTitle: normalizeVersionLabel(releaseVersionTitle)
            ?? (inferred?.scope === 'releaseVersionTitle' ? inferred.label : null)
    };
};

export const normalizeCandidateTitle = (title: string) => {
    const inferred = extractTitleVersionLabel(title);

    return (inferred?.baseTitle ?? title)
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('en-US');
};
