import classNames from 'classnames';
import { cva, type VariantProps } from 'class-variance-authority';
import { activeFilledIconClassName, activeIconClassName, filledIconClassName } from '../iconStateClass';
const cx = classNames;

import React from 'react';

const iconButtonVariants = cva(
    [
        'inline-flex shrink-0 items-center justify-center rounded-full border-0 text-[var(--b-color-text-tertiary)] transition-[color,background-color,transform] duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
        'active:enabled:scale-[0.96] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40'
    ],
    {
        variants: {
            size: {
                xs: 'h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5',
                sm: 'h-10 w-10 [&_svg]:h-4 [&_svg]:w-4',
                md: 'h-11 w-11 [&_svg]:h-4 [&_svg]:w-4',
                compact: 'h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]',
                play: 'h-11 w-11 [&_svg]:h-5 [&_svg]:w-5',
                floating: 'h-16 w-16 [&_svg]:h-7 [&_svg]:w-7',
                utility: 'h-11 w-11 max-lg:h-10 max-lg:w-10 max-lg:text-inherit [&_svg]:h-[18px] [&_svg]:w-[18px] max-lg:[&_svg]:h-5 max-lg:[&_svg]:w-5',
                control: 'h-[clamp(44px,10vw,52px)] w-[clamp(44px,10vw,52px)] justify-self-center [&_svg]:h-5 [&_svg]:w-5',
                controlLg: 'h-[clamp(68px,14vw,76px)] w-[clamp(68px,14vw,76px)] justify-self-center [&_svg]:h-7 [&_svg]:w-7'
            },
            tone: {
                neutral: 'hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]',
                muted: 'text-[var(--b-color-text-secondary)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]',
                strong: 'text-[var(--b-color-text)] hover:bg-[var(--b-color-control-strong-hover)] hover:text-[var(--b-color-static-white)]',
                primary: 'bg-[var(--b-color-point)] text-[var(--b-color-background)] hover:bg-[var(--b-color-point-dark)] hover:text-[var(--b-color-static-white)]',
                gradient: 'bg-[var(--b-gradient-primary)] text-[var(--b-color-background)] hover:text-[var(--b-color-background)]',
                danger: 'hover:bg-[var(--b-color-badge-danger-background)] hover:text-[var(--b-color-badge-danger-text)]'
            },
            active: {
                true: activeIconClassName,
                false: ''
            },
            filled: {
                true: '',
                false: ''
            }
        },
        compoundVariants: [
            {
                active: false,
                filled: true,
                className: filledIconClassName
            },
            {
                active: true,
                filled: true,
                className: activeFilledIconClassName
            }
        ],
        defaultVariants: {
            size: 'md',
            tone: 'neutral',
            active: false,
            filled: false
        }
    }
);

type IconButtonVariantProps = VariantProps<typeof iconButtonVariants>;

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, IconButtonVariantProps {}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(({
    active,
    filled,
    size,
    tone,
    className,
    type = 'button',
    children,
    ...props
}, ref) => {
    return (
        <button
            ref={ref}
            type={type}
            className={cx(iconButtonVariants({ active, filled, size, tone }), className)}
            {...props}>
            {children}
        </button>
    );
});

IconButton.displayName = 'IconButton';

export default IconButton;
