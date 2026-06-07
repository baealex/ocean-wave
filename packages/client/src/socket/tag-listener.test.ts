import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const {
    offMock,
    onMock,
    socketMock
} = vi.hoisted(() => {
    const socketMock = {
        id: 'client-1',
        on: vi.fn(),
        off: vi.fn()
    };

    return {
        offMock: socketMock.off,
        onMock: socketMock.on,
        socketMock
    };
});

vi.mock('./socket', () => ({
    socket: socketMock,
    isOwnRealtimeNotification: (payload?: { originClientId?: string | null }) => {
        return Boolean(payload?.originClientId && payload.originClientId === socketMock.id);
    }
}));

import {
    TAG_CREATED,
    TAG_LIST_INVALIDATED,
    TAG_RENAMED,
    TagListener
} from './tag-listener';

const createTag = (originClientId?: string) => ({
    id: 'tag-1',
    scopeKey: 'music',
    name: 'Focus',
    normalizedName: 'focus',
    color: null,
    description: null,
    order: 0,
    musicCount: 1,
    smartViewCount: 0,
    createdAt: '2026-06-07T00:00:00.000Z',
    updatedAt: '2026-06-07T00:00:00.000Z',
    originClientId
});

describe('TagListener', () => {
    beforeEach(() => {
        socketMock.id = 'client-1';
        onMock.mockReset();
        offMock.mockReset();
    });

    it('subscribes to namespaced tag notification events with wrapped handlers', () => {
        const handler = {
            onCreated: vi.fn(),
            onRenamed: vi.fn(),
            onListInvalidated: vi.fn()
        };
        const listener = new TagListener();

        listener.connect(handler);

        const createdHandler = onMock.mock.calls.find(([event]) => event === TAG_CREATED)?.[1];
        const renamedHandler = onMock.mock.calls.find(([event]) => event === TAG_RENAMED)?.[1];
        const invalidatedHandler = onMock.mock.calls.find(([event]) => event === TAG_LIST_INVALIDATED)?.[1];

        expect(createdHandler).toEqual(expect.any(Function));
        expect(renamedHandler).toEqual(expect.any(Function));
        expect(invalidatedHandler).toEqual(expect.any(Function));

        listener.disconnect();

        expect(offMock).toHaveBeenCalledWith(TAG_CREATED, createdHandler);
        expect(offMock).toHaveBeenCalledWith(TAG_RENAMED, renamedHandler);
        expect(offMock).toHaveBeenCalledWith(TAG_LIST_INVALIDATED, invalidatedHandler);
    });

    it('ignores tag notifications from the same socket client', () => {
        const handler = {
            onCreated: vi.fn(),
            onRenamed: vi.fn(),
            onListInvalidated: vi.fn()
        };
        const listener = new TagListener();

        listener.connect(handler);

        const createdHandler = onMock.mock.calls.find(([event]) => event === TAG_CREATED)?.[1] as (
            tag: ReturnType<typeof createTag>
        ) => void;
        const invalidatedHandler = onMock.mock.calls.find(([event]) => event === TAG_LIST_INVALIDATED)?.[1] as (
            payload: { reason: 'tag-deleted'; originClientId?: string }
        ) => void;

        createdHandler(createTag('client-1'));
        createdHandler(createTag('client-2'));
        invalidatedHandler({
            reason: 'tag-deleted',
            originClientId: 'client-1'
        });
        invalidatedHandler({
            reason: 'tag-deleted',
            originClientId: 'client-2'
        });

        expect(handler.onCreated).toHaveBeenCalledTimes(1);
        expect(handler.onCreated).toHaveBeenCalledWith(createTag('client-2'));
        expect(handler.onListInvalidated).toHaveBeenCalledTimes(1);
        expect(handler.onListInvalidated).toHaveBeenCalledWith({
            reason: 'tag-deleted',
            originClientId: 'client-2'
        });
        listener.disconnect();
    });
});
