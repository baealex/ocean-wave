import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { getMusic } from '~/api/library';
import {
    getMusicMetadataOperations,
    groupMusicAsAlternateFile,
    linkMusicRecordings,
    previewMusicMetadataUpdate,
    recoverMusicMetadataOperation,
    restoreMusicArtwork,
    retryMusicMetadataOperation,
    setPreferredMusicFile,
    ungroupMusicFile,
    unlinkMusicRecording,
    updateMusicMetadata,
    uploadMusicArtwork,
    type MusicMetadataOperation,
    type MusicMetadataPreview
} from '~/api/music';
import { queryKeys } from '~/api/query-keys';
import MusicMetadataFields from '~/components/music/MusicMetadataFields';
import MusicMetadataOperationNotice, {
    metadataOperationNeedsAttention
} from '~/components/music/MusicMetadataOperationNotice';
import MusicMetadataPreviewPanel from '~/components/music/MusicMetadataPreviewPanel';
import MusicVersionManager from '~/components/music/MusicVersionManager';
import {
    Badge,
    Button,
    Image,
    Loading,
    StateMessage,
    Surface,
    Text
} from '~/components/shared';
import { Music, Pencil } from '~/icon';
import type { MusicGroupingCandidate } from '~/models/type';
import {
    musicNeedsMetadataRepair,
    toMusicMetadataEditorValues,
    toUpdateMusicMetadataInput,
    type MusicMetadataEditorValues
} from '~/modules/music-metadata-editor';
import { toast } from '~/modules/toast';
import { musicStore } from '~/store/music';

const MAX_ARTWORK_SIZE = 10 * 1024 * 1024;
const SUPPORTED_ARTWORK_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const getRequestErrorMessage = (error: unknown) => {
    if (axios.isAxiosError<{ message?: string }>(error)) {
        return error.response?.data?.message ?? error.message;
    }

    return error instanceof Error ? error.message : 'Track update failed.';
};

const responseErrorMessage = (
    response: { errors: Array<{ message: string }> },
    fallback: string
) => response.errors[0]?.message ?? fallback;

export default function MusicEdit() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { id } = useParams<{ id: string }>();
    const [values, setValues] = useState<MusicMetadataEditorValues | null>(null);
    const [preview, setPreview] = useState<MusicMetadataPreview | null>(null);
    const [lastOperation, setLastOperation] = useState<MusicMetadataOperation | null>(null);
    const [artworkFile, setArtworkFile] = useState<File | null>(null);
    const [restoreArtwork, setRestoreArtwork] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [versionAction, setVersionAction] = useState<string | null>(null);
    const [operationAction, setOperationAction] = useState<string | null>(null);

    const {
        data: music,
        isError,
        isLoading,
        refetch
    } = useQuery({
        queryKey: queryKeys.music.detail(id),
        queryFn: async () => {
            const { data } = await getMusic(id!);
            return data.music;
        },
        enabled: Boolean(id)
    });

    const {
        data: operations = [],
        isError: isOperationsError,
        refetch: refetchOperations
    } = useQuery({
        queryKey: queryKeys.music.metadataOperations(id),
        queryFn: async () => {
            const response = await getMusicMetadataOperations(id!);

            if (response.type === 'error') {
                throw new Error(responseErrorMessage(
                    response,
                    'Metadata operation history could not be loaded.'
                ));
            }

            return response.musicMetadataOperations;
        },
        enabled: Boolean(id)
    });

    useEffect(() => {
        if (!music) return;

        setValues(toMusicMetadataEditorValues(music));
        setPreview(null);
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

    const initialValues = toMusicMetadataEditorValues(music);
    const metadataChanged = JSON.stringify(values) !== JSON.stringify(initialValues);
    const needsMetadataRepair = musicNeedsMetadataRepair(music);
    const shouldReviewMetadata = metadataChanged || needsMetadataRepair;
    const artworkChanged = Boolean(artworkFile) || restoreArtwork;
    const hasChanges = shouldReviewMetadata || artworkChanged;
    const artworkSource = restoreArtwork ? '' : music.album.cover;
    const isBusy = isSaving
        || isPreviewing
        || Boolean(versionAction)
        || Boolean(operationAction);
    const blockingPreview = preview?.issues.some(issue => issue.blocking) ?? false;
    const canSubmit = preview
        ? preview.hasChanges || artworkChanged
        : hasChanges;
    const latestOperation = lastOperation ?? operations[0] ?? null;
    const attentionOperation = latestOperation
        && metadataOperationNeedsAttention(latestOperation.status)
        ? latestOperation
        : null;

    const refreshLibrarySurfaces = async () => {
        await Promise.all([
            musicStore.sync(),
            queryClient.invalidateQueries({
                queryKey: queryKeys.albums.all(),
                exact: true
            }),
            queryClient.invalidateQueries({
                queryKey: queryKeys.albums.detailAll(),
                exact: false
            }),
            queryClient.invalidateQueries({
                queryKey: queryKeys.artists.all(),
                exact: true
            }),
            queryClient.invalidateQueries({
                queryKey: queryKeys.artists.detailAll(),
                exact: false
            }),
            queryClient.invalidateQueries({
                queryKey: queryKeys.playlists.all(),
                exact: true
            }),
            queryClient.invalidateQueries({
                queryKey: queryKeys.playlists.detailAll(),
                exact: false
            })
        ]);
        await refetch();
    };

    const refreshOperationHistory = async () => {
        await queryClient.invalidateQueries({
            queryKey: queryKeys.music.metadataOperations(music.id),
            exact: true
        });
        await refetchOperations();
    };

    const saveArtwork = async () => {
        if (artworkFile) {
            await uploadMusicArtwork(music.id, artworkFile);
        } else if (restoreArtwork) {
            await restoreMusicArtwork(music.id);
        }
    };

    const finishSuccessfulMetadataUpdate = async () => {
        setPreview(null);
        await refreshLibrarySurfaces();

        if (artworkChanged) {
            try {
                await saveArtwork();
                setArtworkFile(null);
                setRestoreArtwork(false);
                await refreshLibrarySurfaces();
            } catch (error) {
                toast.error(`Metadata was updated, but artwork was not: ${getRequestErrorMessage(error)}`);
                return;
            }
        }

        toast('Track updated');
    };

    const refreshVersionSurfaces = async () => {
        setPreview(null);
        await refreshLibrarySurfaces();
    };

    const runVersionAction = async (
        label: string,
        action: () => Promise<{
            type: 'success';
        } | {
            type: 'error';
            errors: Array<{ message: string }>;
        }>,
        successMessage: string
    ) => {
        if (isBusy) return;

        setVersionAction(label);

        try {
            const response = await action();

            if (response.type === 'error') {
                throw new Error(responseErrorMessage(response, 'Version update failed.'));
            }

            await refreshVersionSurfaces();
            toast(successMessage);
        } catch (error) {
            toast.error(getRequestErrorMessage(error));
        } finally {
            setVersionAction(null);
        }
    };

    const handleGroupingCandidate = (candidate: MusicGroupingCandidate) => {
        if (candidate.kind === 'ALTERNATE_FILE') {
            void runVersionAction(
                `file-${candidate.music.id}`,
                () => groupMusicAsAlternateFile({
                    musicId: candidate.music.id,
                    targetMusicId: music.id
                }),
                'Alternate file grouped'
            );
            return;
        }

        void runVersionAction(
            `recording-${candidate.music.id}`,
            () => linkMusicRecordings({
                musicId: candidate.music.id,
                targetMusicId: music.id
            }),
            'Recording appearances linked'
        );
    };

    const handleValuesChange = (nextValues: MusicMetadataEditorValues) => {
        setValues(nextValues);
        setPreview(null);
    };

    const handleArtworkChange = (file: File | undefined) => {
        if (!file) return;

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

    const createPreview = async () => {
        const input = toUpdateMusicMetadataInput(music.id, values);
        const response = await previewMusicMetadataUpdate(input);

        if (response.type === 'error') {
            throw new Error(responseErrorMessage(response, 'Metadata preview failed.'));
        }

        setPreview(response.previewMusicMetadataUpdate);

        if (!response.previewMusicMetadataUpdate.hasChanges && !artworkChanged) {
            toast('No metadata changes found');
        }
    };

    const applyPreview = async () => {
        if (!preview) return;

        if (!preview.hasChanges) {
            if (artworkChanged) {
                await saveArtwork();
                setArtworkFile(null);
                setRestoreArtwork(false);
                setPreview(null);
                await refreshLibrarySurfaces();
                toast('Artwork updated');
            }
            return;
        }

        const input = toUpdateMusicMetadataInput(music.id, values);
        const response = await updateMusicMetadata(input, preview.token);

        if (response.type === 'error') {
            if (response.errors.some(error => error.code === 'MUSIC_METADATA_PREVIEW_STALE')) {
                setPreview(null);
            }
            throw new Error(responseErrorMessage(response, 'Metadata update failed.'));
        }

        const operation = response.updateMusicMetadata;
        setLastOperation(operation);
        setPreview(null);
        await refreshOperationHistory();

        if (operation.status === 'cleaned') {
            await finishSuccessfulMetadataUpdate();
            return;
        }

        if (operation.music) {
            await refreshLibrarySurfaces();
        }

        toast.error(operation.errorMessage ?? 'Metadata update needs recovery.');
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!canSubmit || isBusy || blockingPreview) return;

        if (!preview && shouldReviewMetadata) {
            setIsPreviewing(true);

            try {
                await createPreview();
            } catch (error) {
                toast.error(getRequestErrorMessage(error));
            } finally {
                setIsPreviewing(false);
            }
            return;
        }

        setIsSaving(true);

        try {
            if (preview) {
                await applyPreview();
            } else {
                await saveArtwork();
                setArtworkFile(null);
                setRestoreArtwork(false);
                await refreshLibrarySurfaces();
                toast('Artwork updated');
            }
        } catch (error) {
            toast.error(getRequestErrorMessage(error));
        } finally {
            setIsSaving(false);
        }
    };

    const runOperationAction = async (
        operationId: string,
        action: typeof retryMusicMetadataOperation | typeof recoverMusicMetadataOperation
    ) => {
        if (isBusy) return;

        setOperationAction(operationId);

        try {
            const response = await action(operationId);

            if (response.type === 'error') {
                throw new Error(responseErrorMessage(response, 'Metadata recovery failed.'));
            }

            const operation = 'retryMusicMetadataOperation' in response
                ? response.retryMusicMetadataOperation
                : response.recoverMusicMetadataOperation;
            setLastOperation(operation);
            await refreshOperationHistory();

            if (operation.status === 'cleaned') {
                setPreview(null);
                await refreshLibrarySurfaces();
                toast('Metadata operation completed');
            } else if (operation.music) {
                await refreshLibrarySurfaces();
                toast.error(operation.errorMessage ?? 'Metadata recovery still needs attention.');
            } else {
                toast.error(operation.errorMessage ?? 'Metadata recovery still needs attention.');
            }
        } catch (error) {
            toast.error(getRequestErrorMessage(error));
        } finally {
            setOperationAction(null);
        }
    };

    const submitLabel = isPreviewing
        ? 'Reviewing…'
        : isSaving
            ? 'Applying…'
            : preview
                ? preview.hasChanges
                    ? 'Apply changes'
                    : artworkChanged
                        ? 'Save artwork'
                        : 'No changes'
                : shouldReviewMetadata
                    ? 'Review changes'
                    : 'Save artwork';

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-8">
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                    <Text as="h1" size="2xl" weight="bold" className="leading-tight tracking-normal">
                        Edit track
                    </Text>
                    {needsMetadataRepair && <Badge tone="warning">File repair pending</Badge>}
                </div>
                <Text as="p" variant="tertiary" size="sm" className="max-w-[680px] leading-relaxed">
                    Review relationship changes and every affected audio file before they are applied.
                </Text>
            </div>

            {isOperationsError && (
                <Surface variant="subtle" padding="responsive" className="flex flex-wrap items-center justify-between gap-3">
                    <Text as="p" size="sm">Previous metadata operations could not be loaded.</Text>
                    <Button type="button" size="xs" onClick={() => void refetchOperations()}>
                        Try again
                    </Button>
                </Surface>
            )}

            {attentionOperation && (
                <MusicMetadataOperationNotice
                    operation={attentionOperation}
                    busy={operationAction === attentionOperation.operationId}
                    onRecover={operationId => void runOperationAction(
                        operationId,
                        recoverMusicMetadataOperation
                    )}
                    onRetry={operationId => void runOperationAction(
                        operationId,
                        retryMusicMetadataOperation
                    )}
                />
            )}

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
                        alt={`${values.releaseTitle} cover`}
                        className="aspect-square w-full rounded-[var(--b-radius-xl)] object-cover shadow-[0_12px_32px_var(--b-color-overlay-strong)]"
                    />
                    <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={isBusy}
                        onChange={event => handleArtworkChange(event.target.files?.[0])}
                        className="block w-full cursor-pointer rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] text-xs font-semibold text-[var(--b-color-text-secondary)] file:mr-3 file:min-h-9 file:border-0 file:border-r file:border-[var(--b-color-border-subtle)] file:bg-[var(--b-color-secondary-button)] file:px-3 file:text-xs file:font-semibold file:text-[var(--b-color-text-secondary)]"
                    />
                    {artworkFile && (
                        <Text as="p" variant="secondary" size="xs" className="break-all leading-relaxed">
                            Selected: {artworkFile.name}
                        </Text>
                    )}
                    <Text as="p" variant="muted" size="xs" className="leading-relaxed">
                        JPEG, PNG, or WebP up to 10 MB. Artwork stays separate from audio tag updates.
                    </Text>
                    {music.album.isCoverCustom && (
                        <Button
                            type="button"
                            variant="ghost"
                            fullWidth
                            disabled={isBusy}
                            onClick={() => {
                                setArtworkFile(null);
                                setRestoreArtwork(current => !current);
                            }}>
                            {restoreArtwork ? 'Keep custom artwork' : 'Restore artwork from audio file'}
                        </Button>
                    )}
                </Surface>

                <Surface as="section" variant="panel" padding="responsive" className="grid gap-5">
                    <div className="flex items-center gap-2">
                        <Pencil className="h-4 w-4 text-[var(--b-color-text-muted)]" />
                        <Text as="h2" size="sectionTitle" weight="semibold">Relational metadata</Text>
                    </div>
                    <MusicMetadataFields
                        values={values}
                        disabled={isBusy}
                        onChange={handleValuesChange}
                    />
                </Surface>
            </div>

            {preview && <MusicMetadataPreviewPanel preview={preview} />}

            <MusicVersionManager
                music={music}
                busy={isBusy}
                onSetPreferred={fileId => void runVersionAction(
                    `preferred-${fileId ?? 'automatic'}`,
                    () => setPreferredMusicFile({ musicId: music.id, fileId }),
                    fileId ? 'Preferred file updated' : 'Quality fallback restored'
                )}
                onUngroupFile={fileId => void runVersionAction(
                    `ungroup-${fileId}`,
                    () => ungroupMusicFile({ musicId: music.id, fileId }),
                    'File separated into its own track'
                )}
                onGroupCandidate={handleGroupingCandidate}
                onUnlinkRecording={() => void runVersionAction(
                    'unlink-recording',
                    () => unlinkMusicRecording({ musicId: music.id }),
                    'Release appearance separated'
                )}
            />

            <Surface variant="subtle" padding="responsive" className="grid gap-2 sm:grid-cols-2">
                <div>
                    <Text as="span" variant="muted" size="xs">Selected audio file</Text>
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
                <Button type="button" variant="ghost" disabled={isBusy} onClick={() => navigate(-1)}>
                    Cancel
                </Button>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!canSubmit || isBusy || blockingPreview}>
                    {submitLabel}
                </Button>
            </div>
        </form>
    );
}
