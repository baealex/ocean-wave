import {
    ModalProvider as BaseModalProvider,
    useModal,
    type AlertComponentProps,
    type ConfirmComponentProps
} from '@baejino/react-ui/modal';
import * as AlertDialog from '@baejino/react-ui/modal/alert-dialog';
import type { ReactNode } from 'react';

import { Button, Text } from '~/components/shared';
import { dialogChromeClass, dialogContentClass, dialogOverlayClass } from '~/components/shared/Modal/DialogShell';

const modalClass = {
    overlay: dialogOverlayClass({ layer: 'alert', tone: 'default' }),
    content: dialogContentClass({ layer: 'alert', width: 'confirm', padding: 'compact' }),
    header: dialogChromeClass.header,
    title: dialogChromeClass.title,
    description: dialogChromeClass.description,
    actions: `${dialogChromeClass.actions} mt-4`,
    button: dialogChromeClass.button
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
