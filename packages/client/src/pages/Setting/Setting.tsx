import { useModal } from '~/components/app/ModalProvider';
import { Text } from '~/components/shared';
import { appCopy } from '~/config/copy';
import { appShell } from '~/config/app-shell';
import { socket } from '~/socket';

import {
    AudioSettingsSection,
    ConnectorsSection,
    PlayModeSection,
    SynchronizationSection,
    TroubleshootingSection
} from './components';


export default function Setting() {
    const { confirm } = useModal();

    const handleClickSyncMusic = async (force: boolean) => {
        if (
            force &&
            !(await confirm({
                title: 'Force sync music?',
                description: 'Please only proceed if this update is recommended by the developer.',
                confirmLabel: 'Force sync'
            }))
        ) {
            return;
        }

        socket.emit('sync-music', { force });
    };

    return (
        <>
            <div className="mb-8 lg:mb-12">
                <Text as="h1" size="xl" weight="bold" className="text-[clamp(2rem,5vw,3.25rem)] leading-[0.98] tracking-[-0.055em]">
                    {appCopy.settings.title}
                </Text>
                <Text as="p" variant="tertiary" size="sm" className="mt-2 max-w-[30rem] leading-relaxed">
                    Tune how Ocean Wave behaves.
                </Text>
            </div>

            <div className="flex flex-col gap-8 lg:gap-12">
                <SynchronizationSection onSyncMusic={handleClickSyncMusic} />
                <PlayModeSection />
                <AudioSettingsSection />
                <ConnectorsSection />
                <TroubleshootingSection />
            </div>

            <div className="mt-12 flex min-h-8 items-center justify-center gap-2 pb-[max(48px,calc(48px+env(safe-area-inset-bottom)))] text-center text-xs text-[var(--b-color-text-muted)]">
                <img
                    src="/brand-logo.svg"
                    alt=""
                    aria-hidden="true"
                    className="h-[1.125rem] w-[1.125rem] rounded-md opacity-70"
                />
                <span>Powered by {appShell.brand.name}</span>
            </div>
        </>
    );
}
