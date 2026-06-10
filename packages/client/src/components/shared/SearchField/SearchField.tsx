import classNames from 'classnames';
import { useEffect, useRef, useState } from 'react';

import * as Icon from '~/icon';

const cx = classNames;

interface SearchFieldProps {
    value: string;
    placeholder?: string;
    ariaLabel?: string;
    onChange: (value: string) => void;
}

export default function SearchField({
    value,
    placeholder = 'Search',
    ariaLabel = 'Search',
    onChange
}: SearchFieldProps) {
    const [draftValue, setDraftValue] = useState(value);
    const isComposingRef = useRef(false);

    useEffect(() => {
        if (!isComposingRef.current) {
            setDraftValue(value);
        }
    }, [value]);

    const handleChange = (nextValue: string) => {
        setDraftValue(nextValue);

        if (!isComposingRef.current) {
            onChange(nextValue);
        }
    };

    const handleClear = () => {
        setDraftValue('');
        onChange('');
    };

    return (
        <label
            className={cx(
                'flex min-h-9 flex-1 basis-72 items-center gap-2 rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)]',
                'min-w-[min(100%,256px)] max-w-md bg-[var(--b-color-surface-subtle)] p-0.5 transition-[border-color,background-color,box-shadow] duration-150',
                'focus-within:border-[var(--b-color-focus)] focus-within:shadow-[0_0_0_3px_var(--b-color-focus-ring)]',
                'max-sm:w-full max-sm:max-w-none max-sm:basis-full'
            )}>
            <Icon.Search className={cx('ml-2.5 h-4 w-4 shrink-0 text-[var(--b-color-text-muted)]')} />
            <input
                value={draftValue}
                className={cx('min-w-0 flex-1 border-0 bg-transparent text-xs font-semibold text-[var(--b-color-text-secondary)] outline-none placeholder:text-[var(--b-color-text-muted)]')}
                placeholder={placeholder}
                aria-label={ariaLabel}
                onCompositionStart={() => {
                    isComposingRef.current = true;
                }}
                onCompositionEnd={(event) => {
                    const nextValue = event.currentTarget.value;

                    isComposingRef.current = false;
                    setDraftValue(nextValue);
                    onChange(nextValue);
                }}
                onChange={(event) => handleChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Escape' && draftValue) {
                        event.preventDefault();
                        handleClear();
                    }
                }}
            />
            {draftValue && (
                <button
                    type="button"
                    className={cx('mr-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[var(--b-color-text-secondary)] transition-[color,background-color] duration-150 hover:bg-white/[0.06] hover:text-[var(--b-color-text)] [&_svg]:h-3.5 [&_svg]:w-3.5')}
                    aria-label="Clear search"
                    onClick={handleClear}>
                    <Icon.Close />
                </button>
            )}
        </label>
    );
}
