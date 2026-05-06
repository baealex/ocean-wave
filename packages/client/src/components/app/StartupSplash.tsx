export default function StartupSplash() {
    return (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-[radial-gradient(circle_at_50%_42%,rgba(139,92,246,0.16),transparent_26rem),rgba(9,9,11,0.78)] p-[var(--b-spacing-lg)] backdrop-blur-[18px] backdrop-saturate-[0.92]" role="status" aria-live="polite" aria-label="Loading music library">
            <div className="flex min-w-[min(20rem,100%)] flex-col items-center gap-[var(--b-spacing-md)] rounded-[var(--b-radius-2xl)] border border-[rgba(244,244,245,0.1)] bg-[rgba(18,18,20,0.82)] p-[var(--b-spacing-xl)]">
                <img className="h-20 w-20 rounded-[1.35rem]" src="/brand-logo.svg" alt="" aria-hidden="true" />
                <div className="flex flex-col items-center gap-1 text-center">
                    <span className="text-xs font-bold tracking-[0.16em] text-[var(--b-color-point-light)] uppercase">Ocean Wave</span>
                    <span className="text-[1.05rem] font-semibold tracking-[-0.03em] text-[var(--b-color-text)]">Warming up your library</span>
                </div>
                <span className="relative h-[3px] w-[8.5rem] overflow-hidden rounded-[var(--b-radius-full)] bg-[rgba(244,244,245,0.1)] after:absolute after:inset-0 after:w-[42%] after:rounded-[inherit] after:bg-[var(--b-color-point-light)] after:content-[''] after:animate-[startup-splash-meter_1.1s_ease-in-out_infinite] motion-reduce:after:w-full motion-reduce:after:animate-none" aria-hidden="true" />
            </div>
        </div>
    );
}
