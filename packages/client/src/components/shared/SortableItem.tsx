import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';

interface SortableItemRenderProps {
    attributes: ReturnType<typeof useSortable>['attributes'];
    listeners: ReturnType<typeof useSortable>['listeners'];
    setActivatorNodeRef: ReturnType<typeof useSortable>['setActivatorNodeRef'];
}

interface SortableItemProps {
    id: string;
    className?: string;
    render: (props: SortableItemRenderProps) => React.ReactNode;
}

const SortableItem = ({ id, className, render }: SortableItemProps) => {
    const {
        attributes,
        listeners,
        setActivatorNodeRef,
        setNodeRef,
        transform,
        transition
    } = useSortable({ id });

    return (
        <div
            ref={setNodeRef}
            className={className}
            style={{
                transform: CSS.Translate.toString(transform),
                transition
            }}>
            {render({ attributes, listeners, setActivatorNodeRef })}
        </div>
    );
};

export default SortableItem;
