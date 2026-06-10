import classNames from 'classnames';
import type React from 'react';

import * as Icon from '~/icon';

const cx = classNames;

interface SelectionCheckButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    selected?: boolean;
    activeTone?: boolean;
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
            className={cx(
                'inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-full border border-transparent bg-transparent px-2.5 py-1.5 text-xs font-semibold text-[var(--b-color-text-tertiary)] transition-[background-color,border-color,color]',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
                '[&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:fill-none [&_svg]:text-current',
                activeTone
                    ? '!bg-[rgba(139,92,246,0.18)] !text-[var(--b-color-point-light)] hover:!bg-[rgba(139,92,246,0.24)] hover:!text-[var(--b-color-point-light)]'
                    : 'hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]',
                className
            )}
            {...props}>
            <Icon.CheckBox />
            {children}
        </button>
    );
}
