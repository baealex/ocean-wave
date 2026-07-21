export const RELEASE_TYPES = [
    'album',
    'ep',
    'single',
    'compilation',
    'live',
    'unknown'
] as const;

export type ReleaseType = typeof RELEASE_TYPES[number];

const RELEASE_TYPE_ALIASES = new Map<string, ReleaseType>([
    ['album', 'album'],
    ['ep', 'ep'],
    ['extendedplay', 'ep'],
    ['single', 'single'],
    ['compilation', 'compilation'],
    ['comp', 'compilation'],
    ['live', 'live'],
    ['unknown', 'unknown']
]);

const RELEASE_TYPE_PRECEDENCE: ReleaseType[] = [
    'compilation',
    'live',
    'ep',
    'single',
    'album'
];

const normalizeReleaseTypeToken = (value: string) => {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
};

export const normalizeReleaseType = ({
    values,
    compilation = false
}: {
    values?: string | string[] | null;
    compilation?: boolean | null;
}): ReleaseType => {
    if (compilation) return 'compilation';

    const rawValues = Array.isArray(values) ? values : values ? [values] : [];
    const resolvedTypes = new Set(rawValues
        .flatMap(value => value.split(/[;,/]/))
        .map(normalizeReleaseTypeToken)
        .map(value => RELEASE_TYPE_ALIASES.get(value))
        .filter((value): value is ReleaseType => Boolean(value)));

    return RELEASE_TYPE_PRECEDENCE.find(value => resolvedTypes.has(value)) ?? 'unknown';
};

export const normalizePositiveInteger = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;

    const number = typeof value === 'number' ? value : Number(value);

    return Number.isInteger(number) && number > 0 && number <= 9999
        ? number
        : null;
};

export interface ReleaseTrackPosition {
    id: number;
    discNumber: number | null;
    trackNumber: number | null;
}

const compareNullablePosition = (left: number | null, right: number | null) => {
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
};

export const compareReleaseTrackPositions = (
    left: ReleaseTrackPosition,
    right: ReleaseTrackPosition
) => {
    return compareNullablePosition(left.discNumber, right.discNumber)
        || compareNullablePosition(left.trackNumber, right.trackNumber)
        || left.id - right.id;
};

export const toGraphQLReleaseType = (releaseType: string) => {
    const normalized = RELEASE_TYPES.includes(releaseType as ReleaseType)
        ? releaseType as ReleaseType
        : 'unknown';

    return normalized.toUpperCase();
};
