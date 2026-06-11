import { cva } from 'class-variance-authority';

export const listRowClass = cva(
    [
        'w-full text-left text-[var(--b-color-text)] transition-[background-color,border-color,opacity]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--b-color-focus)]'
    ],
    {
        variants: {
            layout: {
                actionShell: 'grid min-h-16 items-stretch',
                leading: 'grid min-h-16 items-center gap-3 px-[var(--b-spacing-lg)] py-3',
                selection: 'grid min-h-16 grid-cols-[48px_minmax(0,1fr)] items-center gap-x-[var(--b-spacing-xs)] px-[var(--b-spacing-md)]',
                queue: 'flex min-h-[68px] items-center gap-2 max-sm:min-h-[66px] max-sm:gap-1.5'
            },
            surface: {
                divided: 'border-b border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-hover)]',
                plain: '',
                staticDivided: 'border-b border-[var(--b-color-border-subtle)]',
                queue: 'rounded-[var(--b-radius-xl)] border border-transparent bg-[var(--b-color-surface-subtle)] hover:bg-[linear-gradient(90deg,var(--b-color-surface-subtle),var(--b-color-surface-subtle)),var(--b-gradient-row-hover)]'
            },
            columns: {
                none: '',
                content: 'grid-cols-[2.5rem_minmax(0,1fr)_auto]',
                actionShell: 'grid-cols-[minmax(0,1fr)_auto]'
            },
            selected: {
                true: 'ow-active-surface',
                false: ''
            },
            tone: {
                neutral: '',
                current: 'border-[var(--b-color-focus)] bg-[var(--b-color-surface-item)]',
                past: 'opacity-70',
                upcoming: ''
            },
            disabled: {
                true: 'disabled:cursor-not-allowed disabled:opacity-60',
                false: ''
            }
        },
        compoundVariants: [
            {
                layout: 'queue',
                selected: true,
                className: 'bg-[var(--b-color-surface-item)] hover:bg-[var(--b-color-surface-item)]'
            }
        ],
        defaultVariants: {
            layout: 'leading',
            surface: 'divided',
            columns: 'none',
            selected: false,
            tone: 'neutral',
            disabled: false
        }
    }
);

export const listRowIconClass = cva(
    'flex h-10 w-10 items-center justify-center rounded-[var(--b-radius-md)] border bg-[var(--b-color-surface-subtle)]',
    {
        variants: {
            selected: {
                true: 'border-[var(--b-color-point)] bg-[var(--b-color-point)] text-[var(--b-color-background)]',
                false: 'border-[var(--b-color-border-subtle)] text-[var(--b-color-text-secondary)]'
            }
        },
        defaultVariants: {
            selected: false
        }
    }
);

export const listRowActionRailClass = 'flex items-center gap-1 pr-[var(--b-spacing-md)]';

export const listRowButtonContentClass = cva(
    'border-0 bg-transparent text-left text-inherit',
    {
        variants: {
            layout: {
                leading: 'min-w-0 border-b-0 hover:bg-transparent',
                queue: 'flex min-w-0 flex-1 items-center gap-3.5 py-2.5 max-sm:gap-3 max-sm:pr-0.5'
            }
        },
        defaultVariants: {
            layout: 'leading'
        }
    }
);
