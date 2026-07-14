import { COLLECTION_CARD_HEIGHT_OFFSET } from '../CollectionCard';
import FixedVirtualGrid from '../FixedVirtualGrid';

interface CollectionGridSkeletonProps {
    label: string;
}

const PLACEHOLDERS = Array.from({ length: 12 }, (_, index) => index);

export default function CollectionGridSkeleton({
    label
}: CollectionGridSkeletonProps) {
    return (
        <div role="status" aria-live="polite">
            <span className="sr-only">{label}</span>
            <div aria-hidden="true">
                <FixedVirtualGrid
                    items={PLACEHOLDERS}
                    ariaLabel="Collection loading placeholders"
                    getKey={(index) => index}
                    itemHeightOffset={COLLECTION_CARD_HEIGHT_OFFSET}
                    renderItem={() => (
                        <div className="h-full animate-pulse rounded-[var(--b-radius-xl)] p-2 motion-reduce:animate-none">
                            <div className="aspect-square rounded-[var(--b-radius-lg)] bg-[var(--b-color-surface-item)]" />
                            <div
                                className="flex flex-col px-1 pt-3"
                                style={{ minHeight: COLLECTION_CARD_HEIGHT_OFFSET }}>
                                <div className="h-3.5 w-4/5 rounded-full bg-[var(--b-color-surface-item)]" />
                                <div className="mt-2 h-3 w-3/5 rounded-full bg-[var(--b-color-surface-subtle)]" />
                            </div>
                        </div>
                    )}
                />
            </div>
        </div>
    );
}
