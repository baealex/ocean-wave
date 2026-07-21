import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    useEffect,
    useState,
    type FormEvent,
    type ReactNode
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
    Badge,
    Button,
    Image,
    Input,
    Loading,
    StateMessage,
    Surface,
    Text
} from '~/components/shared';
import { getMusic } from '~/api/library';
import {
    restoreMusicArtwork,
    updateMusicMetadata,
    uploadMusicArtwork
} from '~/api/music';
import { queryKeys } from '~/api/query-keys';
import { Music, Pencil } from '~/icon';
import type {
    ArtistCreditRole,
    Music as MusicModel
} from '~/models/type';
import { toast } from '~/modules/toast';
import { musicStore } from '~/store/music';

const MAX_ARTWORK_SIZE = 10 * 1024 * 1024;
const SUPPORTED_ARTWORK_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface EditorValues {
    title: string;
    artistCredits: CreditEditorValue[];
    album: string;
    albumArtistCredits: CreditEditorValue[];
    publishedYear: string;
    trackNumber: string;
    genres: string;
}

interface CreditEditorValue {
    name: string;
    role: ArtistCreditRole;
    creditedName: string;
    joinPhrase: string;
}

const CREDIT_ROLE_OPTIONS: Array<{ value: ArtistCreditRole; label: string }> = [
    { value: 'PRIMARY', label: 'Primary' },
    { value: 'FEATURED', label: 'Featured' },
    { value: 'REMIXER', label: 'Remixer' },
    { value: 'PERFORMER', label: 'Performer' },
    { value: 'COMPOSER', label: 'Composer' },
    { value: 'CONDUCTOR', label: 'Conductor' },
    { value: 'UNKNOWN', label: 'Unknown' }
];

const toCreditEditorValues = (
    credits: MusicModel['artistCredits'],
    fallbackName: string
): CreditEditorValue[] => {
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

const toEditorValues = (music: MusicModel): EditorValues => ({
    title: music.name,
    artistCredits: toCreditEditorValues(music.artistCredits, music.artist.name),
    album: music.album.name,
    albumArtistCredits: toCreditEditorValues(
        music.album.artistCredits,
        music.album.artist.name
    ),
    publishedYear: music.album.publishedYear,
    trackNumber: music.trackNumber?.toString() ?? '',
    genres: music.genres.map((genre) => genre.name).join(', ')
});

const Field = ({
    label,
    hint,
    children
}: {
    label: string;
    hint?: string;
    children: ReactNode;
}) => (
    <label className="grid min-w-0 content-start gap-2">
        <span className="text-xs font-semibold text-[var(--b-color-text-secondary)]">{label}</span>
        {children}
        {hint && (
            <span className="text-xs leading-relaxed text-[var(--b-color-text-muted)]">{hint}</span>
        )}
    </label>
);

const ArtistCreditEditor = ({
    label,
    credits,
    disabled,
    featuredByDefault,
    onChange
}: {
    label: string;
    credits: CreditEditorValue[];
    disabled: boolean;
    featuredByDefault?: boolean;
    onChange: (credits: CreditEditorValue[]) => void;
}) => {
    const updateCredit = <Key extends keyof CreditEditorValue>(
        index: number,
        key: Key,
        value: CreditEditorValue[Key]
    ) => {
        onChange(credits.map((credit, creditIndex) => (
            creditIndex === index
                ? { ...credit, [key]: value }
                : credit
        )));
    };

    const addCredit = () => {
        const nextCredits = credits.map((credit, index) => (
            index === credits.length - 1 && !credit.joinPhrase
                ? {
                    ...credit,
                    joinPhrase: featuredByDefault ? ' feat. ' : ' & '
                }
                : credit
        ));

        onChange([
            ...nextCredits,
            {
                name: '',
                role: featuredByDefault ? 'FEATURED' : 'PRIMARY',
                creditedName: '',
                joinPhrase: ''
            }
        ]);
    };

    const removeCredit = (index: number) => {
        const nextCredits = credits.filter((_, creditIndex) => creditIndex !== index);

        if (nextCredits.length) {
            nextCredits[nextCredits.length - 1] = {
                ...nextCredits[nextCredits.length - 1],
                joinPhrase: ''
            };
        }

        onChange(nextCredits);
    };

    const moveCredit = (index: number, offset: -1 | 1) => {
        const targetIndex = index + offset;

        if (targetIndex < 0 || targetIndex >= credits.length) return;

        const joinPhrases = credits.map(credit => credit.joinPhrase);
        const nextCredits = [...credits];
        [nextCredits[index], nextCredits[targetIndex]] = [
            nextCredits[targetIndex],
            nextCredits[index]
        ];
        onChange(nextCredits.map((credit, creditIndex) => ({
            ...credit,
            joinPhrase: joinPhrases[creditIndex]
        })));
    };

    return (
        <section className="grid gap-3 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <Text as="h3" size="sm" weight="semibold">{label}</Text>
                    <Text as="p" variant="muted" size="xs" className="mt-1 leading-relaxed">
                        Order controls display. “Join after” keeps text such as “ feat. ” or “ &amp; ”.
                    </Text>
                </div>
                <Button
                    type="button"
                    size="xs"
                    disabled={disabled}
                    onClick={addCredit}>
                    Add artist
                </Button>
            </div>
            <div className="grid gap-3">
                {credits.map((credit, index) => (
                    <div
                        key={`${label}-${index}`}
                        className="grid gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] p-3 md:grid-cols-[minmax(0,1.5fr)_minmax(140px,0.75fr)_minmax(0,1fr)_minmax(110px,0.65fr)_minmax(128px,auto)]">
                        <Field label={`Artist ${index + 1}`}>
                            <Input
                                required
                                value={credit.name}
                                disabled={disabled}
                                onChange={(event) => updateCredit(index, 'name', event.target.value)}
                            />
                        </Field>
                        <Field label="Role">
                            <select
                                value={credit.role}
                                disabled={disabled}
                                aria-label={`${label} artist ${index + 1} role`}
                                onChange={(event) => updateCredit(
                                    index,
                                    'role',
                                    event.target.value as ArtistCreditRole
                                )}
                                className="min-h-10 w-full rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-input)] px-3 text-sm text-[var(--b-color-text)] focus-visible:border-[var(--b-color-focus)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--b-color-focus-ring)] disabled:opacity-40">
                                {CREDIT_ROLE_OPTIONS.map(option => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Credited as" hint="Optional display alias.">
                            <Input
                                value={credit.creditedName}
                                disabled={disabled}
                                placeholder={credit.name || 'Artist name'}
                                onChange={(event) => updateCredit(
                                    index,
                                    'creditedName',
                                    event.target.value
                                )}
                            />
                        </Field>
                        <Field label="Join after">
                            <Input
                                value={credit.joinPhrase}
                                disabled={disabled}
                                placeholder={index === credits.length - 1 ? 'None' : ' & '}
                                onChange={(event) => updateCredit(
                                    index,
                                    'joinPhrase',
                                    event.target.value
                                )}
                            />
                        </Field>
                        <div className="flex flex-wrap items-end gap-1">
                            <Button
                                type="button"
                                size="xs"
                                disabled={disabled || index === 0}
                                aria-label={`Move ${label.toLowerCase()} artist ${index + 1} up`}
                                onClick={() => moveCredit(index, -1)}>
                                ↑
                            </Button>
                            <Button
                                type="button"
                                size="xs"
                                disabled={disabled || index === credits.length - 1}
                                aria-label={`Move ${label.toLowerCase()} artist ${index + 1} down`}
                                onClick={() => moveCredit(index, 1)}>
                                ↓
                            </Button>
                            <Button
                                type="button"
                                size="xs"
                                variant="danger"
                                disabled={disabled || credits.length === 1}
                                aria-label={`Remove ${label.toLowerCase()} artist ${index + 1}`}
                                onClick={() => removeCredit(index)}>
                                Remove
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};

const getRequestErrorMessage = (error: unknown) => {
    if (axios.isAxiosError<{ message?: string }>(error)) {
        return error.response?.data?.message ?? error.message;
    }

    return error instanceof Error ? error.message : 'Track update failed.';
};

export default function MusicEdit() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { id } = useParams<{ id: string }>();
    const [values, setValues] = useState<EditorValues | null>(null);
    const [artworkFile, setArtworkFile] = useState<File | null>(null);
    const [restoreArtwork, setRestoreArtwork] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const { data: music, isError, isLoading, refetch } = useQuery({
        queryKey: queryKeys.music.detail(id),
        queryFn: async () => {
            const { data } = await getMusic(id!);
            return data.music;
        },
        enabled: Boolean(id)
    });

    useEffect(() => {
        if (music) {
            setValues(toEditorValues(music));
        }
    }, [music]);

    if (isLoading || !values && !isError) {
        return <Loading />;
    }

    if (isError || !music || !values) {
        return (
            <div className="flex min-h-full items-center justify-center p-[var(--b-spacing-lg)]">
                <StateMessage
                    surface
                    icon={<Music />}
                    heading="Track not found."
                    description="The track could not be loaded. Go back and choose another track."
                    actions={(
                        <Button variant="primary" onClick={() => navigate(-1)}>
                            Go back
                        </Button>
                    )}
                />
            </div>
        );
    }

    const initialValues = toEditorValues(music);
    const metadataChanged = JSON.stringify(values) !== JSON.stringify(initialValues);
    const shouldWriteMetadata = metadataChanged || music.hasMetadataOverride;
    const artworkChanged = Boolean(artworkFile) || restoreArtwork;
    const hasChanges = shouldWriteMetadata || artworkChanged;
    const artworkSource = restoreArtwork ? '' : music.album.cover;

    const updateValue = (key: keyof EditorValues, value: string) => {
        setValues((current) => current ? { ...current, [key]: value } : current);
    };

    const updateCredits = (
        key: 'artistCredits' | 'albumArtistCredits',
        credits: CreditEditorValue[]
    ) => {
        setValues((current) => current ? { ...current, [key]: credits } : current);
    };

    const handleArtworkChange = (file: File | undefined) => {
        if (!file) {
            return;
        }

        if (!SUPPORTED_ARTWORK_TYPES.has(file.type)) {
            toast.error('Choose a JPEG, PNG, or WebP image.');
            return;
        }

        if (file.size > MAX_ARTWORK_SIZE) {
            toast.error('Album artwork must be 10 MB or smaller.');
            return;
        }

        setArtworkFile(file);
        setRestoreArtwork(false);
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!hasChanges || isSaving) {
            return;
        }

        const trackNumber = Number(values.trackNumber);

        if (!Number.isInteger(trackNumber) || trackNumber < 1 || trackNumber > 9999) {
            toast.error('Track number must be between 1 and 9999.');
            return;
        }

        setIsSaving(true);

        try {
            if (shouldWriteMetadata) {
                const response = await updateMusicMetadata({
                    id: music.id,
                    title: values.title,
                    artistCredits: values.artistCredits.map(credit => ({
                        ...credit,
                        creditedName: credit.creditedName || null
                    })),
                    album: values.album,
                    albumArtistCredits: values.albumArtistCredits.map(credit => ({
                        ...credit,
                        creditedName: credit.creditedName || null
                    })),
                    publishedYear: values.publishedYear,
                    trackNumber,
                    genres: values.genres.split(',')
                });

                if (response.type === 'error') {
                    throw new Error(response.errors[0]?.message ?? 'Track metadata update failed.');
                }
            }

            if (artworkFile) {
                await uploadMusicArtwork(music.id, artworkFile);
            } else if (restoreArtwork) {
                await restoreMusicArtwork(music.id);
            }

            await Promise.all([
                musicStore.sync(),
                queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() }),
                queryClient.invalidateQueries({ queryKey: ['album'] }),
                queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() }),
                queryClient.invalidateQueries({ queryKey: ['artist'] })
            ]);
            await refetch();
            setArtworkFile(null);
            setRestoreArtwork(false);
            toast('Track updated');
        } catch (error) {
            toast.error(getRequestErrorMessage(error));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-8">
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                    <Text as="h1" size="2xl" weight="bold" className="leading-tight tracking-normal">
                        Edit track
                    </Text>
                    {music.hasMetadataOverride && <Badge tone="accent">File update pending</Badge>}
                </div>
                <Text as="p" variant="tertiary" size="sm" className="max-w-[640px] leading-relaxed">
                    Metadata changes are written to the audio file so they survive rescans and move with your library.
                </Text>
            </div>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
                <Surface as="section" variant="panel" padding="responsive" className="grid gap-4">
                    <div className="flex items-center justify-between gap-3">
                        <Text as="h2" size="sectionTitle" weight="semibold">Album artwork</Text>
                        {music.album.isCoverCustom && !restoreArtwork && (
                            <Badge tone="accent">Custom</Badge>
                        )}
                    </div>
                    <Image
                        src={artworkSource}
                        alt={`${values.album} cover`}
                        className="aspect-square w-full rounded-[var(--b-radius-xl)] object-cover shadow-[0_12px_32px_var(--b-color-overlay-strong)]"
                    />
                    <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={isSaving}
                        onChange={(event) => handleArtworkChange(event.target.files?.[0])}
                        className="block w-full cursor-pointer rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] text-xs font-semibold text-[var(--b-color-text-secondary)] file:mr-3 file:min-h-9 file:border-0 file:border-r file:border-[var(--b-color-border-subtle)] file:bg-[var(--b-color-secondary-button)] file:px-3 file:text-xs file:font-semibold file:text-[var(--b-color-text-secondary)]"
                    />
                    {artworkFile && (
                        <Text as="p" variant="secondary" size="xs" className="break-all leading-relaxed">
                            Selected: {artworkFile.name}
                        </Text>
                    )}
                    <Text as="p" variant="muted" size="xs" className="leading-relaxed">
                        JPEG, PNG, or WebP up to 10 MB. Artwork is shared by every track in this album.
                    </Text>
                    {music.album.isCoverCustom && (
                        <Button
                            type="button"
                            variant="ghost"
                            fullWidth
                            disabled={isSaving}
                            onClick={() => {
                                setArtworkFile(null);
                                setRestoreArtwork((current) => !current);
                            }}>
                            {restoreArtwork ? 'Keep custom artwork' : 'Restore artwork from audio file'}
                        </Button>
                    )}
                </Surface>

                <Surface as="section" variant="panel" padding="responsive" className="grid gap-5">
                    <div className="flex items-center gap-2">
                        <Pencil className="h-4 w-4 text-[var(--b-color-text-muted)]" />
                        <Text as="h2" size="sectionTitle" weight="semibold">Metadata</Text>
                    </div>
                    <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Title">
                            <Input
                                required
                                value={values.title}
                                disabled={isSaving}
                                onChange={(event) => updateValue('title', event.target.value)}
                            />
                        </Field>
                        <Field label="Album">
                            <Input
                                required
                                value={values.album}
                                disabled={isSaving}
                                onChange={(event) => updateValue('album', event.target.value)}
                            />
                        </Field>
                        <Field label="Release year">
                            <Input
                                required
                                inputMode="numeric"
                                maxLength={4}
                                pattern="\d{4}"
                                value={values.publishedYear}
                                disabled={isSaving}
                                onChange={(event) => updateValue('publishedYear', event.target.value)}
                            />
                        </Field>
                        <Field label="Track number">
                            <Input
                                required
                                type="number"
                                min="1"
                                max="9999"
                                value={values.trackNumber}
                                disabled={isSaving}
                                onChange={(event) => updateValue('trackNumber', event.target.value)}
                            />
                        </Field>
                        <div className="sm:col-span-2">
                            <Field label="Genres" hint="Separate multiple genres with commas.">
                                <Input
                                    value={values.genres}
                                    disabled={isSaving}
                                    placeholder="Electronic, Ambient"
                                    onChange={(event) => updateValue('genres', event.target.value)}
                                />
                            </Field>
                        </div>
                        <ArtistCreditEditor
                            label="Track artists"
                            credits={values.artistCredits}
                            disabled={isSaving}
                            featuredByDefault
                            onChange={(credits) => updateCredits('artistCredits', credits)}
                        />
                        <ArtistCreditEditor
                            label="Album artists"
                            credits={values.albumArtistCredits}
                            disabled={isSaving}
                            onChange={(credits) => updateCredits('albumArtistCredits', credits)}
                        />
                    </div>
                </Surface>
            </div>

            <Surface variant="subtle" padding="responsive" className="grid gap-2 sm:grid-cols-2">
                <div>
                    <Text as="span" variant="muted" size="xs">Audio file</Text>
                    <Text as="p" size="sm" className="mt-1 break-all">{music.filePath}</Text>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:text-right">
                    <div>
                        <Text as="span" variant="muted" size="xs">Codec</Text>
                        <Text as="p" size="sm" className="mt-1">{music.codec || 'Unknown'}</Text>
                    </div>
                    <div>
                        <Text as="span" variant="muted" size="xs">Bitrate</Text>
                        <Text as="p" size="sm" className="mt-1">
                            {music.bitrate ? `${Math.round(music.bitrate / 1000)} kbps` : 'Unknown'}
                        </Text>
                    </div>
                    <div>
                        <Text as="span" variant="muted" size="xs">Sample rate</Text>
                        <Text as="p" size="sm" className="mt-1">
                            {music.sampleRate ? `${Math.round(music.sampleRate / 1000)} kHz` : 'Unknown'}
                        </Text>
                    </div>
                </div>
            </Surface>

            <div className="flex flex-wrap justify-end gap-3">
                <Button type="button" variant="ghost" disabled={isSaving} onClick={() => navigate(-1)}>
                    Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={!hasChanges || isSaving}>
                    {isSaving ? 'Saving…' : 'Save changes'}
                </Button>
            </div>
        </form>
    );
}
