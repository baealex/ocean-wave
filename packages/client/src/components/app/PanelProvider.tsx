import { useCallback } from 'react';

import { useAppStore as useStore } from '~/store/base-store';

import BottomPanel from '~/components/shared/BottomPanel';

import { panel } from '~/modules/panel';

interface PanelProviderProps {
    children: React.ReactNode;
}

export default function PanelProvider({ children }: PanelProviderProps) {
    const [{ isOpen, title, content }] = useStore(panel);
    const handleClose = useCallback(() => panel.close(), []);
    const handleAfterClose = useCallback(() => panel.completeClose(), []);

    return (
        <>
            {children}
            <BottomPanel
                title={title}
                isOpen={isOpen}
                onClose={handleClose}
                onAfterClose={handleAfterClose}>
                {content}
            </BottomPanel>
        </>
    );
}
