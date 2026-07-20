import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    MINI_PLAYER_TOAST_OFFSET_PROPERTY,
    observeMiniPlayerToastOffset
} from './mini-player-toast-offset';

describe('mini-player toast offset', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('tracks the full responsive player height while feedback is visible', () => {
        let height = 132.2;
        const resizeCallbacks: Array<() => void> = [];
        const properties = new Map<string, string>();
        const root = {
            style: {
                getPropertyValue: (name: string) => properties.get(name) ?? '',
                removeProperty: (name: string) => properties.delete(name),
                setProperty: (name: string, value: string) => properties.set(name, value)
            }
        } as unknown as HTMLElement;
        const miniPlayer = {
            getBoundingClientRect: () => ({ height })
        } as HTMLElement;
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: () => void) {
                resizeCallbacks.push(callback);
            }

            observe() {}
            disconnect() {}
        });

        const stopObserving = observeMiniPlayerToastOffset(miniPlayer, root);
        expect(properties.get(MINI_PLAYER_TOAST_OFFSET_PROPERTY)).toBe('133px');

        height = 196;
        resizeCallbacks[0]?.();
        expect(properties.get(MINI_PLAYER_TOAST_OFFSET_PROPERTY)).toBe('196px');

        stopObserving();
        expect(properties.has(MINI_PLAYER_TOAST_OFFSET_PROPERTY)).toBe(false);
    });
});
