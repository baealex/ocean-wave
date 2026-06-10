import classNames from 'classnames';

import { CheckBox, DoubleCheck } from '~/icon';

interface MusicSelectorProps {
    active: boolean;
    label: string;
    onClick: () => void;
    onSelectAll: () => void;
}

export default function MusicSelector({
    active,
    label,
    onClick,
    onSelectAll
}: MusicSelectorProps) {
    return (
        <>
            <button
                type="button"
                className={classNames(
                    'flex w-auto cursor-pointer items-center justify-center gap-2 text-[12.8px] [&_svg]:h-4 [&_svg]:w-4',
                    active && 'text-[var(--b-color-point)]'
                )}
                onClick={onClick}>
                <CheckBox />
                {label}
            </button>
            {active && (
                <button
                    type="button"
                    className="flex w-auto cursor-pointer items-center justify-center gap-2 text-[12.8px] [&_svg]:h-4 [&_svg]:w-4"
                    onClick={onSelectAll}>
                    <DoubleCheck />
                    Select All
                </button>
            )}
        </>
    );
}
