import { describe, expect, it } from 'vitest';
import { audioRetryDelay, withRetryToken } from './network-retry';
describe('audio network retry', () => {
    it('uses bounded exponential delays', () => expect([1, 2, 3, 9].map(audioRetryDelay)).toEqual([1_000, 2_000, 4_000, 8_000]));
    it('keeps stream options while changing the retry token', () => expect(withRetryToken('/api/audio/1?profile=data-saver', 2)).toBe('/api/audio/1?profile=data-saver&retry=2'));
});
