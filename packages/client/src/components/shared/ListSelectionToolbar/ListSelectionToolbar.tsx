import classNames from 'classnames';
import { cva } from 'class-variance-authority';

import Button from '../Button';
import SelectionCheckButton from './SelectionCheckButton';

const cx = classNames;

const listSelectionToolbarClass = cva(
    'flex flex-wrap items-center justify-start gap-2',
    {
        variants: {
            sticky: {
                true: 'sticky z-[4] bg-[var(--b-color-background)]',
                false: ''
            }
        },
        defaultVariants: {
            sticky: false
        }
    }
);

interface ListSelectionToolbarProps {
    className?: string;
    sticky?: boolean;
    isSelecting: boolean;
    selectedCount: number;
    totalCount: number;
    selectLabel?: string;
    selectedLabel?: string;
    onStartSelect: () => void;
    onStopSelect: () => void;
    onSelectAll: () => void;
    onClear: () => void;
}

export default function ListSelectionToolbar({
    className,
    sticky = false,
    isSelecting,
    selectedCount,
    totalCount,
    selectLabel = 'Select',
    selectedLabel = 'selected',
    onStartSelect,
    onStopSelect,
    onSelectAll,
    onClear
}: ListSelectionToolbarProps) {
    return (
        <div className={cx(
            listSelectionToolbarClass({ sticky }),
            className
        )}>
            {isSelecting ? (
                <>
                    <SelectionCheckButton
                        selected
                        aria-pressed
                        aria-label={`Stop selecting ${selectedLabel}`}
                        onClick={onStopSelect}>
                        {selectedCount} selected
                    </SelectionCheckButton>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={selectedCount === totalCount}
                        onClick={onSelectAll}>
                        Select all
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={selectedCount === 0}
                        onClick={onClear}>
                        Clear
                    </Button>
                </>
            ) : (
                <SelectionCheckButton
                    aria-label={selectLabel}
                    onClick={onStartSelect}>
                    {selectLabel}
                </SelectionCheckButton>
            )}
        </div>
    );
}
