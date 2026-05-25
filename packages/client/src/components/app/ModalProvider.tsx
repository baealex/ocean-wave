import {
    ModalProvider as BaseModalProvider,
    useModal,
    type AlertComponentProps,
    type ConfirmComponentProps
} from '@baejino/react-ui/modal';
import * as AlertDialog from '@baejino/react-ui/modal/alert-dialog';
import type { ReactNode } from 'react';

import { Button, Text } from '~/components/shared';

const modalClass = {
    overlay: 'fixed inset-0 z-[120] bg-[var(--b-color-overlay-default)] animate-[fade-in_180ms_ease]',
    content: 'fixed left-1/2 top-1/2 z-[121] w-[min(calc(100vw_-_1.5rem),26rem)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-modal)] p-3.5 text-[var(--b-color-text)] shadow-[0_12px_28px_rgba(2,8,11,0.22)] focus:outline-none max-sm:w-[min(calc(100vw_-_1rem),26rem)]',
    header: 'flex flex-col gap-2',
    title: 'tracking-normal',
    description: 'leading-[1.45]',
    actions: 'mt-4 flex justify-end gap-2.5 max-sm:flex-col-reverse',
    button: 'min-w-[5.5rem] max-sm:w-full'
};

const AlertModal = ({ open, options, onClose }: AlertComponentProps) => {
    return (
        <AlertDialog.Root
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && options.dismissible) {
                    onClose();
                }
            }}>
            <AlertDialog.Portal>
                <AlertDialog.Overlay
                    className={modalClass.overlay}
                    onClick={() => {
                        if (options.dismissible) {
                            onClose();
                        }
                    }}
                />

                <AlertDialog.Content className={modalClass.content}>
                    <div className={modalClass.header}>
                        <AlertDialog.Title asChild>
                            <Text as="h2" size="md" weight="semibold" className={modalClass.title}>
                                {options.title}
                            </Text>
                        </AlertDialog.Title>

                        {options.description && (
                            <AlertDialog.Description asChild>
                                <Text as="p" variant="secondary" size="sm" className={modalClass.description}>
                                    {options.description}
                                </Text>
                            </AlertDialog.Description>
                        )}
                    </div>

                    <div className={modalClass.actions}>
                        <AlertDialog.Action asChild>
                            <Button className={modalClass.button} variant="primary" onClick={onClose}>
                                {options.confirmLabel}
                            </Button>
                        </AlertDialog.Action>
                    </div>
                </AlertDialog.Content>
            </AlertDialog.Portal>
        </AlertDialog.Root>
    );
};

const ConfirmModal = ({ open, options, onCancel, onConfirm }: ConfirmComponentProps) => {
    return (
        <AlertDialog.Root
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && options.dismissible) {
                    onCancel();
                }
            }}>
            <AlertDialog.Portal>
                <AlertDialog.Overlay
                    className={modalClass.overlay}
                    onClick={() => {
                        if (options.dismissible) {
                            onCancel();
                        }
                    }}
                />

                <AlertDialog.Content className={modalClass.content}>
                    <div className={modalClass.header}>
                        <AlertDialog.Title asChild>
                            <Text as="h2" size="md" weight="semibold" className={modalClass.title}>
                                {options.title}
                            </Text>
                        </AlertDialog.Title>

                        {options.description && (
                            <AlertDialog.Description asChild>
                                <Text as="p" variant="secondary" size="sm" className={modalClass.description}>
                                    {options.description}
                                </Text>
                            </AlertDialog.Description>
                        )}
                    </div>

                    <div className={modalClass.actions}>
                        <AlertDialog.Cancel asChild>
                            <Button className={modalClass.button} variant="secondary" onClick={onCancel}>
                                {options.cancelLabel}
                            </Button>
                        </AlertDialog.Cancel>

                        <AlertDialog.Action asChild>
                            <Button
                                className={modalClass.button}
                                variant={options.tone === 'danger' ? 'danger' : 'primary'}
                                onClick={onConfirm}>
                                {options.confirmLabel}
                            </Button>
                        </AlertDialog.Action>
                    </div>
                </AlertDialog.Content>
            </AlertDialog.Portal>
        </AlertDialog.Root>
    );
};

export { useModal };

export default function ModalProvider({ children }: { children?: ReactNode }) {
    return (
        <BaseModalProvider
            components={{
                Alert: AlertModal,
                Confirm: ConfirmModal
            }}>
            {children}
        </BaseModalProvider>
    );
}
