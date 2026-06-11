import { appShell } from '~/config/app-shell';
import { Button, Surface, Tag, Text } from '~/components/shared';
import { Music } from '~/icon';

type AuthGateState = 'loading' | 'error';

interface AuthGateProps {
    state: AuthGateState;
    errorMessage?: string | null;
    onRetry?: () => Promise<void> | void;
}

export default function AuthGate({
    state,
    errorMessage,
    onRetry
}: AuthGateProps) {
    return (
        <div className="grid min-h-dvh w-full place-items-center overflow-auto bg-[var(--b-gradient-page)] p-6 max-sm:p-4">
            <Surface as="section" variant="panel" radius="2xl" padding="lg" className="w-[min(440px,calc(100vw-32px))] shadow-none [backdrop-filter:var(--b-backdrop-filter-panel-background)] max-sm:w-full max-sm:rounded-[var(--b-radius-xl)] max-sm:p-[var(--b-spacing-lg)]">
                <div className="mb-[18px] flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--b-radius-lg)] bg-[var(--b-gradient-primary)] text-[var(--b-color-background)] shadow-none [&_svg]:h-5 [&_svg]:w-5" aria-hidden="true">
                        <Music />
                    </span>
                    <Text as="span" variant="secondary" size="overline" weight="bold" className="inline-flex text-[var(--b-color-point-light)]">
                        {state === 'loading'
                            ? 'Checking Session'
                            : 'Session Check Failed'}
                    </Text>
                </div>
                <Text as="h1" size="2xl" weight="bold" className="m-0 text-[clamp(32px,5vw,40px)] leading-[1.12] tracking-normal text-[var(--b-color-text)]">
                    {appShell.brand.name}
                </Text>
                <Text as="p" variant="secondary" className="mt-[var(--b-spacing-md)] mb-0 leading-[1.6] text-[var(--b-color-text-secondary)]">
                    {state === 'loading'
                        ? 'Checking whether this listening space is open or requires the shared password.'
                        : state === 'error'
                            ? 'Ocean Wave could not verify the current auth state yet. Retry once the server is reachable.'
                            : null}
                </Text>
                {errorMessage && (
                    <div
                        role="alert"
                        className="mt-[var(--b-spacing-lg)] rounded-[var(--b-radius-lg)] border border-[var(--b-color-danger-border)] bg-[var(--b-color-danger-surface)] px-4 py-3.5 text-sm leading-[1.45] text-[var(--b-color-danger-text)]">
                        {errorMessage}
                    </div>
                )}
                <div className="mt-[var(--b-spacing-lg)]">
                    {state === 'loading' ? (
                        <Tag tone="accent" selected>Verifying session...</Tag>
                    ) : (
                        <Button variant="primary" fullWidth onClick={() => void onRetry?.()}>
                            Retry Session Check
                        </Button>
                    )}
                </div>
            </Surface>
        </div>
    );
}
