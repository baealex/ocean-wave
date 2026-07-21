import type { ReactNode } from 'react';

import { Button, Input, Text, Toggle } from '~/components/shared';
import type { ArtistCreditRole, ReleaseType } from '~/models/type';
import type {
    MusicMetadataCreditValue,
    MusicMetadataEditorValues
} from '~/modules/music-metadata-editor';

const CREDIT_ROLE_OPTIONS: Array<{ value: ArtistCreditRole; label: string }> = [
    { value: 'PRIMARY', label: 'Primary' },
    { value: 'FEATURED', label: 'Featured' },
    { value: 'REMIXER', label: 'Remixer' },
    { value: 'PERFORMER', label: 'Performer' },
    { value: 'COMPOSER', label: 'Composer' },
    { value: 'CONDUCTOR', label: 'Conductor' },
    { value: 'UNKNOWN', label: 'Unknown' }
];

const RELEASE_TYPE_OPTIONS: Array<{ value: ReleaseType; label: string }> = [
    { value: 'ALBUM', label: 'Album' },
    { value: 'EP', label: 'EP' },
    { value: 'SINGLE', label: 'Single' },
    { value: 'COMPILATION', label: 'Compilation' },
    { value: 'LIVE', label: 'Live' },
    { value: 'UNKNOWN', label: 'Unknown' }
];

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
    credits: MusicMetadataCreditValue[];
    disabled: boolean;
    featuredByDefault?: boolean;
    onChange: (credits: MusicMetadataCreditValue[]) => void;
}) => {
    const updateCredit = <Key extends keyof MusicMetadataCreditValue>(
        index: number,
        key: Key,
        value: MusicMetadataCreditValue[Key]
    ) => {
        onChange(credits.map((credit, creditIndex) => (
            creditIndex === index ? { ...credit, [key]: value } : credit
        )));
    };

    const addCredit = () => {
        const nextCredits = credits.map((credit, index) => (
            index === credits.length - 1 && !credit.joinPhrase
                ? { ...credit, joinPhrase: featuredByDefault ? ' feat. ' : ' & ' }
                : credit
        ));

        onChange([...nextCredits, {
            name: '',
            role: featuredByDefault ? 'FEATURED' : 'PRIMARY',
            creditedName: '',
            joinPhrase: ''
        }]);
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
        <div className="grid gap-3 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <Text as="h4" size="sm" weight="semibold">{label}</Text>
                    <Text as="p" variant="muted" size="xs" className="mt-1 leading-relaxed">
                        Order controls display. “Join after” keeps text such as “ feat. ” or “ &amp; ”.
                    </Text>
                </div>
                <Button type="button" size="xs" disabled={disabled} onClick={addCredit}>
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
                                onChange={event => updateCredit(index, 'name', event.target.value)}
                            />
                        </Field>
                        <Field label="Role">
                            <select
                                value={credit.role}
                                disabled={disabled}
                                aria-label={`${label} artist ${index + 1} role`}
                                onChange={event => updateCredit(
                                    index,
                                    'role',
                                    event.target.value as ArtistCreditRole
                                )}
                                className="min-h-10 w-full rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-input)] px-3 text-sm text-[var(--b-color-text)] focus-visible:border-[var(--b-color-focus)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--b-color-focus-ring)] disabled:opacity-40">
                                {CREDIT_ROLE_OPTIONS.map(option => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Credited as" hint="Optional display alias.">
                            <Input
                                value={credit.creditedName}
                                disabled={disabled}
                                placeholder={credit.name || 'Artist name'}
                                onChange={event => updateCredit(
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
                                onChange={event => updateCredit(
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
        </div>
    );
};

export default function MusicMetadataFields({
    values,
    disabled,
    onChange
}: {
    values: MusicMetadataEditorValues;
    disabled: boolean;
    onChange: (values: MusicMetadataEditorValues) => void;
}) {
    const updateValue = <Key extends keyof MusicMetadataEditorValues>(
        key: Key,
        value: MusicMetadataEditorValues[Key]
    ) => onChange({ ...values, [key]: value });

    return (
        <div className="grid gap-6">
            <section className="grid gap-4" aria-labelledby="recording-fields-heading">
                <div>
                    <Text id="recording-fields-heading" as="h3" size="sm" weight="semibold">
                        Recording
                    </Text>
                    <Text as="p" variant="muted" size="xs" className="mt-1">
                        Shared by every release appearance of this recording.
                    </Text>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Recording title">
                        <Input
                            required
                            value={values.recordingTitle}
                            disabled={disabled}
                            onChange={event => updateValue('recordingTitle', event.target.value)}
                        />
                    </Field>
                    <Field label="Recording version" hint="Examples: Live, Acoustic, Radio Edit.">
                        <Input
                            value={values.recordingVersionTitle}
                            disabled={disabled}
                            onChange={event => updateValue('recordingVersionTitle', event.target.value)}
                        />
                    </Field>
                    <div className="sm:col-span-2">
                        <Field label="Genres" hint="Separate multiple genres with commas.">
                            <Input
                                value={values.genres}
                                disabled={disabled}
                                placeholder="Electronic, Ambient"
                                onChange={event => updateValue('genres', event.target.value)}
                            />
                        </Field>
                    </div>
                    <ArtistCreditEditor
                        label="Recording artists"
                        credits={values.recordingArtistCredits}
                        disabled={disabled}
                        featuredByDefault
                        onChange={credits => updateValue('recordingArtistCredits', credits)}
                    />
                </div>
            </section>

            <div className="h-px bg-[var(--b-color-border-subtle)]" />

            <section className="grid gap-4" aria-labelledby="appearance-fields-heading">
                <div>
                    <Text id="appearance-fields-heading" as="h3" size="sm" weight="semibold">
                        Release appearance
                    </Text>
                    <Text as="p" variant="muted" size="xs" className="mt-1">
                        Applies only to this track placement on the release.
                    </Text>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Title override" hint="Leave blank to use the recording title.">
                        <Input
                            value={values.titleOverride}
                            disabled={disabled}
                            onChange={event => updateValue('titleOverride', event.target.value)}
                        />
                    </Field>
                    <Field label="Release version" hint="A version label specific to this release.">
                        <Input
                            value={values.releaseVersionTitle}
                            disabled={disabled}
                            onChange={event => updateValue('releaseVersionTitle', event.target.value)}
                        />
                    </Field>
                    <Field label="Disc number" hint="Optional.">
                        <Input
                            type="number"
                            min="1"
                            max="9999"
                            value={values.discNumber}
                            disabled={disabled}
                            onChange={event => updateValue('discNumber', event.target.value)}
                        />
                    </Field>
                    <Field label="Track number" hint="Optional.">
                        <Input
                            type="number"
                            min="1"
                            max="9999"
                            value={values.trackNumber}
                            disabled={disabled}
                            onChange={event => updateValue('trackNumber', event.target.value)}
                        />
                    </Field>
                    <div className="sm:col-span-2">
                        <Toggle
                            value={values.useAppearanceCredits}
                            disabled={disabled}
                            ariaLabel="Use separate release appearance artist credits"
                            onChange={value => updateValue('useAppearanceCredits', value)}>
                            Use separate artists for this release appearance
                        </Toggle>
                    </div>
                    {values.useAppearanceCredits && (
                        <ArtistCreditEditor
                            label="Appearance artists"
                            credits={values.releaseTrackArtistCredits}
                            disabled={disabled}
                            featuredByDefault
                            onChange={credits => updateValue('releaseTrackArtistCredits', credits)}
                        />
                    )}
                </div>
            </section>

            <div className="h-px bg-[var(--b-color-border-subtle)]" />

            <section className="grid gap-4" aria-labelledby="release-fields-heading">
                <div>
                    <Text id="release-fields-heading" as="h3" size="sm" weight="semibold">
                        Release
                    </Text>
                    <Text as="p" variant="muted" size="xs" className="mt-1">
                        Shared by every track on this album, EP, or single.
                    </Text>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Release title">
                        <Input
                            required
                            value={values.releaseTitle}
                            disabled={disabled}
                            onChange={event => updateValue('releaseTitle', event.target.value)}
                        />
                    </Field>
                    <Field label="Release date" hint="Use YYYY, YYYY-MM, or YYYY-MM-DD.">
                        <Input
                            value={values.releaseDate}
                            disabled={disabled}
                            placeholder="2026-07-21"
                            pattern="[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?"
                            onChange={event => updateValue('releaseDate', event.target.value)}
                        />
                    </Field>
                    <Field label="Release type">
                        <select
                            value={values.releaseType}
                            disabled={disabled}
                            aria-label="Release type"
                            onChange={event => updateValue(
                                'releaseType',
                                event.target.value as ReleaseType
                            )}
                            className="min-h-10 w-full rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-input)] px-3 text-sm text-[var(--b-color-text)] focus-visible:border-[var(--b-color-focus)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--b-color-focus-ring)] disabled:opacity-40">
                            {RELEASE_TYPE_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Total discs" hint="Optional.">
                        <Input
                            type="number"
                            min="1"
                            max="9999"
                            value={values.totalDiscs}
                            disabled={disabled}
                            onChange={event => updateValue('totalDiscs', event.target.value)}
                        />
                    </Field>
                    <ArtistCreditEditor
                        label="Release artists"
                        credits={values.releaseArtistCredits}
                        disabled={disabled}
                        onChange={credits => updateValue('releaseArtistCredits', credits)}
                    />
                </div>
            </section>
        </div>
    );
}
