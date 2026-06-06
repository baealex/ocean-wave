import {
    describe,
    expect,
    it
} from 'vitest';

import {
    getOriginClientId,
    isOwnRealtimeNotification
} from './socket';

describe('origin client notification helpers', () => {
    it('uses a stable client id independent of Socket.IO connection ids', () => {
        const firstClientId = getOriginClientId();
        const secondClientId = getOriginClientId();

        expect(firstClientId).toBeTruthy();
        expect(secondClientId).toBe(firstClientId);
        expect(isOwnRealtimeNotification({ originClientId: firstClientId })).toBe(true);
        expect(isOwnRealtimeNotification({ originClientId: 'other-client' })).toBe(false);
        expect(isOwnRealtimeNotification({})).toBe(false);
    });
});
