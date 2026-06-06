import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const {
    offMock,
    onMock
} = vi.hoisted(() => ({
    offMock: vi.fn(),
    onMock: vi.fn()
}));

vi.mock('./socket', () => ({
    socket: {
        on: onMock,
        off: offMock
    }
}));

import {
    TAG_CREATED,
    TAG_LIST_INVALIDATED,
    TAG_RENAMED,
    TagListener
} from './tag-listener';

describe('TagListener', () => {
    beforeEach(() => {
        onMock.mockReset();
        offMock.mockReset();
    });

    it('subscribes to namespaced tag notification events', () => {
        const handler = {
            onCreated: vi.fn(),
            onRenamed: vi.fn(),
            onListInvalidated: vi.fn()
        };
        const listener = new TagListener();

        listener.connect(handler);

        expect(onMock).toHaveBeenCalledWith(TAG_CREATED, handler.onCreated);
        expect(onMock).toHaveBeenCalledWith(TAG_RENAMED, handler.onRenamed);
        expect(onMock).toHaveBeenCalledWith(TAG_LIST_INVALIDATED, handler.onListInvalidated);

        listener.disconnect();

        expect(offMock).toHaveBeenCalledWith(TAG_CREATED, handler.onCreated);
        expect(offMock).toHaveBeenCalledWith(TAG_RENAMED, handler.onRenamed);
        expect(offMock).toHaveBeenCalledWith(TAG_LIST_INVALIDATED, handler.onListInvalidated);
    });
});

