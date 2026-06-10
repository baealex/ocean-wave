import Button from '~/components/shared/Button';
import Input from '~/components/shared/Input';
import Text from '~/components/shared/Text';

import * as Dialog from '@baejino/react-ui/modal/dialog';

interface TextEntryDialogProps {
    open: boolean;
    title: string;
    description?: string;
    value: string;
    placeholder?: string;
    confirmLabel: string;
    cancelLabel?: string;
    pending?: boolean;
    onValueChange: (value: string) => void;
    onConfirm: (value: string) => void;
    onClose: () => void;
}

const dialogClass = {
    overlay: 'fixed inset-0 z-[122] bg-[var(--b-color-overlay-strong)] animate-[fade-in_180ms_ease]',
    content: 'fixed left-1/2 top-1/2 z-[123] w-[min(calc(100vw_-_24px),448px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-modal)] p-4 text-[var(--b-color-text)] shadow-[var(--b-card-shadow-sub)] focus:outline-none max-sm:w-[min(calc(100vw_-_16px),448px)] max-sm:p-3.5',
    form: 'flex flex-col gap-4',
    header: 'flex flex-col gap-2',
    title: 'tracking-normal',
    description: 'leading-[1.45]',
    actions: 'flex justify-end gap-2.5 max-sm:flex-col-reverse',
    button: 'min-w-[88px] max-sm:w-full'
};

export default function TextEntryDialog({
    open,
    title,
    description,
    value,
    placeholder,
    confirmLabel,
    cancelLabel = 'Cancel',
    pending = false,
    onValueChange,
    onConfirm,
    onClose
}: TextEntryDialogProps) {
    const trimmedValue = value.trim();

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    onClose();
                }
            }}>
            <Dialog.Portal>
                <Dialog.Overlay className={dialogClass.overlay} />

                <Dialog.Content className={dialogClass.content}>
                    <form
                        className={dialogClass.form}
                        onSubmit={(event) => {
                            event.preventDefault();

                            if (pending || !trimmedValue) {
                                return;
                            }

                            onConfirm(trimmedValue);
                        }}>
                        <div className={dialogClass.header}>
                            <Dialog.Title asChild>
                                <Text as="h2" size="md" weight="semibold" className={dialogClass.title}>
                                    {title}
                                </Text>
                            </Dialog.Title>

                            {description && (
                                <Dialog.Description asChild>
                                    <Text as="p" variant="secondary" size="sm" className={dialogClass.description}>
                                        {description}
                                    </Text>
                                </Dialog.Description>
                            )}
                        </div>

                        <Input
                            autoFocus
                            value={value}
                            inputSize="lg"
                            placeholder={placeholder}
                            onChange={(event) => onValueChange(event.currentTarget.value)}
                        />

                        <div className={dialogClass.actions}>
                            <Dialog.Close asChild>
                                <Button className={dialogClass.button} variant="secondary">
                                    {cancelLabel}
                                </Button>
                            </Dialog.Close>

                            <Button
                                type="submit"
                                className={dialogClass.button}
                                variant="primary"
                                disabled={pending || !trimmedValue}>
                                {confirmLabel}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
