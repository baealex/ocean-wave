import * as SelectPrimitive from '@baejino/react-ui/select';
import { cva } from 'class-variance-authority';

import * as Icon from '~/icon';

interface Option {
    value: string;
    label: string;
}

interface SelectProps {
    selected?: Option;
    options: Option[];
    ariaLabel: string;
    onChange: (value: string) => void;
}

const triggerClass = cva([
    'inline-flex min-h-10 w-[min(100%,320px)] min-w-56 items-center justify-between gap-3 rounded-[var(--b-radius-md)]',
    'border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] px-3 py-1.5',
    'text-xs font-semibold text-[var(--b-color-text-secondary)] transition-[border-color,background-color,box-shadow,color] duration-150',
    'hover:text-[var(--b-color-text)]',
    'focus-visible:border-[var(--b-color-focus)] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--b-color-focus-ring)]',
    'data-[state=open]:bg-[var(--b-color-hover)] data-[state=open]:text-[var(--b-color-text)] max-md:w-full max-md:min-w-0'
]);

const contentClass = cva([
    'z-40 max-h-[min(288px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)]',
    'max-w-[min(384px,calc(100vw-32px))] overflow-hidden rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)]',
    'bg-[var(--b-color-surface-dropdown)] text-[var(--b-color-text)] shadow-[var(--b-card-shadow-sub)]',
    'data-[state=open]:animate-[select-content-in_140ms_ease-out]'
]);

const itemClass = cva([
    'relative flex min-h-9 cursor-default select-none items-center rounded-[var(--b-radius-md)] py-2 pl-3 pr-9',
    'text-xs leading-[1.45] text-[var(--b-color-text)] transition-[background-color,color,transform] duration-150',
    'data-[highlighted]:bg-[var(--b-color-hover)] data-[highlighted]:outline-none',
    'ow-select-checked data-[state=checked]:font-semibold'
]);

const EMPTY_OPTION_VALUE = '__ocean-wave-empty-option__';

const toInternalValue = (value: string) => (value === '' ? EMPTY_OPTION_VALUE : value);
const fromInternalValue = (value: string) => (value === EMPTY_OPTION_VALUE ? '' : value);

export default function Select({ selected, options, ariaLabel, onChange }: SelectProps) {
    return (
        <SelectPrimitive.Root
            value={selected ? toInternalValue(selected.value) : undefined}
            onValueChange={(value) => onChange(fromInternalValue(value))}>
            <SelectPrimitive.Trigger className={triggerClass()} aria-label={ariaLabel}>
                <SelectPrimitive.Value placeholder="Select an option" />
                <SelectPrimitive.Icon className="shrink-0 text-[var(--b-color-text-muted)] [&_svg]:h-4 [&_svg]:w-4">
                    <Icon.ChevronDown />
                </SelectPrimitive.Icon>
            </SelectPrimitive.Trigger>

            <SelectPrimitive.Portal>
                <SelectPrimitive.Content
                    className={contentClass()}
                    position="popper"
                    sideOffset={8}>
                    <SelectPrimitive.Viewport className="p-1.5">
                        {options.map((option) => (
                            <SelectPrimitive.Item
                                key={option.value || EMPTY_OPTION_VALUE}
                                value={toInternalValue(option.value)}
                                className={itemClass()}>
                                <SelectPrimitive.ItemText>
                                    {option.label}
                                </SelectPrimitive.ItemText>
                                <SelectPrimitive.ItemIndicator className="absolute right-3.5 top-1/2 flex -translate-y-1/2 items-center justify-center text-[var(--b-color-point)] [&_svg]:h-[15px] [&_svg]:w-[15px] [&_svg]:stroke-[var(--b-color-point)]">
                                    <Icon.Check />
                                </SelectPrimitive.ItemIndicator>
                            </SelectPrimitive.Item>
                        ))}
                    </SelectPrimitive.Viewport>
                </SelectPrimitive.Content>
            </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
    );
}
