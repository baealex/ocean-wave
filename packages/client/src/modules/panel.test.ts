import { describe, expect, it, vi } from 'vitest';

import { PanelStore } from './panel';

const createPanelStore = () => new PanelStore();

describe('PanelStore', () => {
    it('runs a deferred action only after the panel close completes', () => {
        const store = createPanelStore();
        const afterClose = vi.fn();

        store.open({ content: 'Panel content' });
        store.close(afterClose);

        expect(afterClose).not.toHaveBeenCalled();

        store.completeClose();

        expect(afterClose).toHaveBeenCalledOnce();
    });

    it('preserves the deferred action when close is requested again', () => {
        const store = createPanelStore();
        const afterClose = vi.fn();

        store.open({ content: 'Panel content' });
        store.close(afterClose);
        store.close();
        store.completeClose();

        expect(afterClose).toHaveBeenCalledOnce();
    });

    it('clears a stale deferred action when another panel opens', () => {
        const store = createPanelStore();
        const afterClose = vi.fn();

        store.open({ content: 'First panel' });
        store.close(afterClose);
        store.open({ content: 'Second panel' });
        store.completeClose();

        expect(afterClose).not.toHaveBeenCalled();
    });
});
