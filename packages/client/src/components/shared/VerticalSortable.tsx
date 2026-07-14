import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type Announcements,
    type DragEndEvent
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToFirstScrollableAncestor, restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';

interface VerticalSortableProps {
    items: string[];
    children: React.ReactNode;
    getItemLabel?: (id: string) => string;
    onDragEnd: (event: DragEndEvent) => void;
}

export default function VerticalSortable({
    items,
    onDragEnd,
    getItemLabel = (id) => id,
    children
}: VerticalSortableProps) {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    const describeItem = (id: string | number) => {
        const itemId = String(id);
        const position = items.indexOf(itemId) + 1;
        const positionDescription = position > 0
            ? `position ${position} of ${items.length}`
            : 'its current position';

        return {
            label: getItemLabel(itemId),
            positionDescription
        };
    };
    const announcements: Announcements = {
        onDragStart: ({ active }) => {
            const { label, positionDescription } = describeItem(active.id);

            return `Picked up ${label}, ${positionDescription}.`;
        },
        onDragOver: ({ active, over }) => {
            if (!over) {
                return `${getItemLabel(String(active.id))} is no longer over a valid position.`;
            }

            const { positionDescription } = describeItem(over.id);

            return `${getItemLabel(String(active.id))} moved to ${positionDescription}.`;
        },
        onDragEnd: ({ active, over }) => {
            if (!over) {
                return `${getItemLabel(String(active.id))} was dropped outside the list.`;
            }

            const { positionDescription } = describeItem(over.id);

            return `${getItemLabel(String(active.id))} was dropped at ${positionDescription}.`;
        },
        onDragCancel: ({ active }) => {
            const { label, positionDescription } = describeItem(active.id);

            return `Sorting cancelled. ${label} returned to ${positionDescription}.`;
        }
    };

    return (
        <DndContext
            accessibility={{
                announcements,
                screenReaderInstructions: {
                    draggable: 'To pick up a sortable item, press space or enter. While sorting, use the arrow keys to move it. Press space or enter to drop, or escape to cancel.'
                }
            }}
            sensors={sensors}
            modifiers={[
                restrictToVerticalAxis,
                restrictToParentElement,
                restrictToFirstScrollableAncestor
            ]}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}>
            <SortableContext
                items={items}
                strategy={verticalListSortingStrategy}>
                {children}
            </SortableContext>
        </DndContext>
    );

}
