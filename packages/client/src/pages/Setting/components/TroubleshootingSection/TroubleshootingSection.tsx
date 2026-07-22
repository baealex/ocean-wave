import { useState } from 'react';
import { getConnectivityDiagnostics, type ConnectivityDiagnostics } from '~/api/connectivity';
import { Button, SettingSection, SettingItem, Text } from '~/components/shared';


const AlertIcon = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

export const TroubleshootingSection = () => {
    const [result, setResult] = useState<(ConnectivityDiagnostics & { roundTripMs: number })>();
    const [checking, setChecking] = useState(false);
    const check = async () => {
        setChecking(true);
        try { setResult(await getConnectivityDiagnostics()); } finally { setChecking(false); }
    };
    return (
        <SettingSection
            title="Troubleshooting"
            icon={<AlertIcon />}
            description="Having issues with the application? Try these solutions.">
            <SettingItem title="Connection diagnostics" description="Check authentication, byte-range streaming, sockets, response delay, and transcoding load without changing your router.">
                <Button disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Run checks'}</Button>
            </SettingItem>
            {result && <div className="border-b border-[var(--b-color-border-subtle)] py-3"><Text as="p" size="xs" variant="muted">Authentication {result.authenticated ? 'OK' : 'failed'} · Range {result.rangeRequests ? 'OK' : 'failed'} · Audio file {result.streamReadable ? 'readable' : 'unavailable'} · Socket clients {result.socketConnections} · {result.roundTripMs} ms round trip · Transcodes {result.transcodes.active}/{result.transcodes.maximum}</Text></div>}
            <SettingItem
                title="Refresh Application"
                description="Reload the application to resolve common issues.">
                <div className="flex justify-end gap-[var(--b-spacing-sm)] max-[720px]:justify-start">
                    <Button onClick={() => window.location.reload()}>
                        Refresh App
                    </Button>
                </div>
            </SettingItem>
            <SettingItem
                title="Give Feedback"
                description="Give feedback to help us improve the application.">
                <div className="flex justify-end gap-[var(--b-spacing-sm)] max-[720px]:justify-start">
                    <Button onClick={() => window.open('https://feedback.baejino.com/s/nfhsuyckehiwfgbpuzesy6dp', '_blank')}>
                        Give Feedback
                    </Button>
                </div>
            </SettingItem>
        </SettingSection>
    );
};
