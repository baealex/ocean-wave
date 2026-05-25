import * as Dialog from '@baejino/react-ui/modal/dialog';
import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';

import { useDragDismiss } from '~/hooks';

interface BottomPanelProps {
    title?: string;
    isOpen: boolean;
    onClose?: () => void;
    children: React.ReactNode;
}

const DEFAULT_TITLE = 'Action panel';

export default function BottomPanel({
    title,
    isOpen,
    onClose,
    children
}: BottomPanelProps) {
    const hasPush = useRef(false);
    const {
        dragOffset,
        handlePointerDown,
        handlePointerMove,
        handlePointerEnd
    } = useDragDismiss({
        enabled: isOpen,
        onDismiss: onClose
    });

    useEffect(() => {
        if (!isOpen) {
            if (hasPush.current) {
                hasPush.current = false;
                history.back();
            }
            return;
        }

        if (!hasPush.current) {
            hasPush.current = true;
            history.pushState(null, '');
        }

        const handlePopState = () => {
            hasPush.current = false;
            onClose?.();
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, [isOpen, onClose]);

    return (
        <Dialog.Root
            open={isOpen}
            onOpenChange={(open) => {
                if (!open) {
                    onClose?.();
                }
            }}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[110] bg-[var(--b-color-overlay-strong)] will-change-[opacity] animate-[fade-in_180ms_ease]" />

                <Dialog.Content
                    className="fixed bottom-0 left-1/2 z-[111] flex max-h-[min(80dvh,42rem)] w-[min(100vw,37.5rem)] -translate-x-1/2 translate-y-[var(--panel-offset)] flex-col overflow-hidden rounded-t-[1.25rem] border border-b-0 border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-modal)] text-[var(--b-color-text)] shadow-[var(--b-card-shadow-sub)] focus:outline-none max-sm:max-h-[85dvh] max-sm:w-screen max-sm:rounded-t-[1.125rem]"
                    style={{ '--panel-offset': `${dragOffset}px` } as CSSProperties}>
                    <div
                        className="relative cursor-grab touch-none select-none px-4 pb-3.5 pt-7 active:cursor-grabbing"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerEnd}
                        onPointerCancel={handlePointerEnd}>
                        <div className="absolute left-1/2 top-3 h-[0.3125rem] w-12 -translate-x-1/2 shrink-0 rounded-full bg-white/[0.18]" aria-hidden="true" />

                        <Dialog.Title className={title ? 'm-0 w-full text-left text-sm font-semibold tracking-normal text-[var(--b-color-text-secondary)]' : 'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]'}>
                            {title || DEFAULT_TITLE}
                        </Dialog.Title>
                    </div>

                    <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:px-3.5 max-sm:pb-[max(0.875rem,env(safe-area-inset-bottom))]">
                        {children}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
