import { Surface, Text } from '~/components/shared';

export default function StartupSplash() {
    return (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-[radial-gradient(circle_at_50%_42%,var(--b-color-point-glow),transparent_416px),var(--b-color-splash-backdrop)] p-[var(--b-spacing-lg)] backdrop-blur-[18px] backdrop-saturate-[0.92]" role="status" aria-live="polite" aria-label="Loading music library">
            <Surface variant="bare" radius="2xl" padding="lg" className="flex min-w-[min(320px,100%)] flex-col items-center gap-[var(--b-spacing-md)] border-[var(--b-color-splash-track)] bg-[var(--b-color-splash-surface)]">
                <img className="h-20 w-20 rounded-[var(--b-radius-xl)]" src="/brand-logo.svg" alt="" aria-hidden="true" />
                <div className="flex flex-col items-center gap-1 text-center">
                    <Text as="span" size="overline" weight="bold" className="text-[var(--b-color-point-light)]">Ocean Wave</Text>
                    <Text as="span" size="sectionTitle">Warming up your library</Text>
                </div>
                <span className="relative h-[3px] w-[136px] overflow-hidden rounded-[var(--b-radius-full)] bg-[var(--b-color-splash-track)] after:absolute after:inset-0 after:w-[42%] after:rounded-[inherit] after:bg-[var(--b-color-point-light)] after:content-[''] after:animate-[startup-splash-meter_1.1s_ease-in-out_infinite] motion-reduce:after:w-full motion-reduce:after:animate-none" aria-hidden="true" />
            </Surface>
        </div>
    );
}
