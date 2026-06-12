import classNames from 'classnames';
import { cva } from 'class-variance-authority';
import type React from 'react';

import * as Icon from '~/icon';

const cx = classNames;

const selectionCheckButtonClass = cva(
    [
        'inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-semibold text-[var(--b-color-text-tertiary)] transition-[background-color,border-color,color]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
        '[&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:fill-none [&_svg]:text-current'
    ],
    {
        variants: {
            selected: {
                true: 'border-[var(--b-color-focus)] ow-active-surface',
                false: 'border-transparent bg-transparent'
            },
            activeTone: {
                true: 'text-[var(--b-color-point)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-point)]',
                false: 'hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]'
            }
        },
        defaultVariants: {
            selected: false,
            activeTone: false
        }
    }
);

const selectionCheckIconClass = cva(
    'inline-flex items-center justify-center transition-colors',
    {
        variants: {
            selected: {
                true: 'text-[var(--b-color-point)]',
                false: 'text-[var(--b-color-text-tertiary)]'
            }
        },
        defaultVariants: {
            selected: false
        }
    }
);

interface SelectionCheckButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    selected?: boolean;
    activeTone?: boolean;
}

interface SelectionCheckIndicatorProps extends React.HTMLAttributes<HTMLSpanElement> {
    selected?: boolean;
    activeTone?: boolean;
}

function SelectionCheckContent({
    selected,
    children
}: {
    selected: boolean;
    children?: React.ReactNode;
}) {
    return (
        <>
            <span className={selectionCheckIconClass({ selected })}>
                {selected ? <Icon.CheckBox /> : <Icon.Square />}
            </span>
            {children}
        </>
    );
}

export default function SelectionCheckButton({
    selected = false,
    activeTone = selected,
    className,
    type = 'button',
    children,
    ...props
}: SelectionCheckButtonProps) {
    return (
        <button
            type={type}
            className={cx(selectionCheckButtonClass({ activeTone, selected }), className)}
            {...props}>
            <SelectionCheckContent selected={selected}>
                {children}
            </SelectionCheckContent>
        </button>
    );
}

export function SelectionCheckIndicator({
    selected = false,
    activeTone = selected,
    className,
    children,
    ...props
}: SelectionCheckIndicatorProps) {
    return (
        <span
            className={cx(selectionCheckButtonClass({ activeTone, selected }), className)}
            {...props}>
            <SelectionCheckContent selected={selected}>
                {children}
            </SelectionCheckContent>
        </span>
    );
}
