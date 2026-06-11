import { cva } from 'class-variance-authority';

export const dialogOverlayClass = cva('fixed inset-0 animate-[fade-in_180ms_ease]', {
    variants: {
        layer: {
            alert: 'z-[120]',
            form: 'z-[122]'
        },
        tone: {
            default: 'bg-[var(--b-color-overlay-default)]',
            strong: 'bg-[var(--b-color-overlay-strong)]'
        }
    },
    defaultVariants: {
        layer: 'alert',
        tone: 'default'
    }
});

export const dialogContentClass = cva(
    [
        'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
        'rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)]',
        'bg-[var(--b-color-surface-modal)] text-[var(--b-color-text)] shadow-[var(--b-card-shadow-sub)] focus:outline-none'
    ],
    {
        variants: {
            layer: {
                alert: 'z-[121]',
                form: 'z-[123]'
            },
            width: {
                confirm: 'w-[min(calc(100vw_-_24px),416px)] max-sm:w-[min(calc(100vw_-_16px),416px)]',
                form: 'w-[min(calc(100vw_-_24px),448px)] max-sm:w-[min(calc(100vw_-_16px),448px)]'
            },
            padding: {
                compact: 'p-3.5',
                form: 'p-4 max-sm:p-3.5'
            }
        },
        defaultVariants: {
            layer: 'alert',
            width: 'confirm',
            padding: 'compact'
        }
    }
);

export const dialogChromeClass = {
    actions: 'flex justify-end gap-2.5 max-sm:flex-col-reverse',
    button: 'min-w-[88px] max-sm:w-full',
    description: 'leading-[1.45]',
    header: 'flex flex-col gap-2',
    title: 'tracking-normal'
};
