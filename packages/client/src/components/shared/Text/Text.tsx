import classNames from 'classnames';
import { cva, type VariantProps } from 'class-variance-authority';
const cx = classNames;

export type TextElement = 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'div' | 'strong';
export type TextVariant = 'primary' | 'secondary' | 'tertiary' | 'muted';
export type TextSize = 'xs' | 'sm' | 'md' | 'overline' | 'sectionTitle' | 'title' | 'xl' | '2xl';
export type TextWeight = 'normal' | 'medium' | 'semibold' | 'bold';

const textVariants = cva('m-0 p-0 leading-[1.45]', {
    variants: {
        variant: {
            primary: 'text-[var(--b-color-text)]',
            secondary: 'text-[var(--b-color-text-secondary)]',
            tertiary: 'text-[var(--b-color-text-tertiary)]',
            muted: 'text-[var(--b-color-text-muted)]'
        },
        size: {
            xs: 'text-xs',
            sm: 'text-sm',
            md: 'text-base',
            overline: 'text-xs uppercase tracking-normal',
            sectionTitle: 'text-base font-semibold leading-tight',
            title: 'text-xl leading-tight',
            xl: 'text-2xl leading-tight',
            '2xl': 'text-3xl leading-[1.12]'
        },
        weight: {
            normal: 'font-normal',
            medium: 'font-medium',
            semibold: 'font-semibold',
            bold: 'font-bold'
        },
        truncate: {
            true: 'truncate'
        }
    },
    defaultVariants: {
        variant: 'primary',
        size: 'md',
        weight: 'normal',
        truncate: false
    }
});

type TextVariantProps = VariantProps<typeof textVariants>;

interface TextProps extends React.HTMLAttributes<HTMLElement>, TextVariantProps {
    as?: TextElement;
    children: React.ReactNode;
}

const Text = ({
    as: Component = 'span',
    variant,
    size,
    weight,
    truncate,
    className,
    children,
    ...props
}: TextProps) => {
    return (
        <Component
            className={cx(textVariants({ variant, size, weight, truncate }), className)}
            {...props}>
            {children}
        </Component>
    );
};

export default Text;
