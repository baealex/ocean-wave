import Button from '~/components/shared/Button';
import Input from '~/components/shared/Input';
import Text from '~/components/shared/Text';

import * as Dialog from '@baejino/react-ui/modal/dialog';
import { dialogChromeClass, dialogContentClass, dialogOverlayClass } from './DialogShell';

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
    overlay: dialogOverlayClass({ layer: 'form', tone: 'strong' }),
    content: dialogContentClass({ layer: 'form', width: 'form', padding: 'form' }),
    form: 'flex flex-col gap-4',
    header: dialogChromeClass.header,
    title: dialogChromeClass.title,
    description: dialogChromeClass.description,
    actions: dialogChromeClass.actions,
    button: dialogChromeClass.button
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
