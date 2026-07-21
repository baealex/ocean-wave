import { useState } from 'react';

import type {
    PersonalListeningSessionLength,
    PersonalListeningSessionScope
} from '~/api/personal-listening-session';
import { Button, Text } from '~/components/shared';
import { usePersonalListeningSessionStarter } from '~/hooks/usePersonalListeningSessionStarter';
import {
    DEFAULT_PERSONAL_LISTENING_SESSION_OPTIONS,
    PERSONAL_LISTENING_SESSION_LENGTH_OPTIONS,
    PERSONAL_LISTENING_SESSION_SCOPE_OPTIONS
} from '~/modules/personal-listening-session';

interface PersonalListeningSessionOptionsPanelContentProps {
    musicName: string;
    startMusicId: string;
}

const PersonalListeningSessionOptionsPanelContent = ({
    musicName,
    startMusicId
}: PersonalListeningSessionOptionsPanelContentProps) => {
    const [length, setLength] = useState<PersonalListeningSessionLength>(
        DEFAULT_PERSONAL_LISTENING_SESSION_OPTIONS.length
    );
    const [scope, setScope] = useState<PersonalListeningSessionScope>(
        DEFAULT_PERSONAL_LISTENING_SESSION_OPTIONS.scope
    );
    const starter = usePersonalListeningSessionStarter();

    return (
        <div className="flex flex-col gap-6 py-5">
            <div>
                <Text as="p" size="sm" weight="semibold">
                    Start from “{musicName}”
                </Text>
                <Text as="p" size="xs" variant="secondary" className="mt-1">
                    Ocean Wave uses only your library, listening history, tags,
                    genres, and saved Views.
                </Text>
            </div>

            <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-xs font-semibold text-[var(--b-color-text-secondary)]">
                    Length
                </legend>
                <div className="grid grid-cols-3 gap-2">
                    {PERSONAL_LISTENING_SESSION_LENGTH_OPTIONS.map(option => (
                        <Button
                            key={option.value}
                            active={length === option.value}
                            aria-pressed={length === option.value}
                            disabled={starter.starting}
                            onClick={() => setLength(option.value)}>
                            {option.label} · {option.trackCount}
                        </Button>
                    ))}
                </div>
                <Text as="p" size="xs" variant="secondary">
                    {PERSONAL_LISTENING_SESSION_LENGTH_OPTIONS.find(
                        option => option.value === length
                    )?.description}
                </Text>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-xs font-semibold text-[var(--b-color-text-secondary)]">
                    Range
                </legend>
                {PERSONAL_LISTENING_SESSION_SCOPE_OPTIONS.map(option => (
                    <Button
                        key={option.value}
                        active={scope === option.value}
                        aria-pressed={scope === option.value}
                        disabled={starter.starting}
                        fullWidth
                        className="h-auto justify-start px-3 py-2.5 text-left"
                        onClick={() => setScope(option.value)}>
                        <span className="flex flex-col items-start gap-1">
                            <span>{option.label}</span>
                            <span className="font-normal text-[var(--b-color-text-muted)]">
                                {option.description}
                            </span>
                        </span>
                    </Button>
                ))}
            </fieldset>

            {starter.message && (
                <Text
                    as="p"
                    size="xs"
                    variant="secondary"
                    role="alert"
                    aria-live="assertive">
                    {starter.message}
                </Text>
            )}

            <Button
                variant="primary"
                fullWidth
                disabled={starter.starting}
                onClick={() => void starter.start({
                    length,
                    scope,
                    startMusicId
                })}>
                {starter.starting ? 'Starting session…' : 'Start session'}
            </Button>
        </div>
    );
};

export default PersonalListeningSessionOptionsPanelContent;
