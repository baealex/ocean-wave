import { cva } from 'class-variance-authority';

export const libraryRowClass = cva(
    [
        'group/row w-full cursor-pointer text-left text-[var(--b-color-text)] transition-colors',
        'ow-active-press',
        'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--b-color-focus)]'
    ],
    {
        variants: {
            layout: {
                list: 'flex flex-row items-center gap-4 px-6 py-4',
                playlist: 'flex min-w-0 flex-1 items-center gap-3 rounded-[var(--b-radius-lg)] px-2 py-2',
                playlistReorder: 'flex flex-row items-center gap-4 px-4 py-2.5',
                album: 'relative grid h-full grid-cols-[78px_minmax(0,1fr)_auto] items-center gap-4 px-6 py-2 max-sm:grid-cols-[78px_minmax(0,1fr)]',
                albumCompact: 'relative grid min-h-[88px] grid-cols-[78px_minmax(0,1fr)] items-center gap-3 px-2 py-2 max-sm:grid-cols-[78px_minmax(0,1fr)]',
                card: 'flex min-w-0 flex-1 items-center gap-4 rounded-[var(--b-radius-lg)] bg-[var(--b-color-surface-item)] p-4'
            },
            dimmed: {
                true: 'opacity-40',
                false: ''
            }
        },
        defaultVariants: {
            layout: 'list',
            dimmed: false
        }
    }
);
