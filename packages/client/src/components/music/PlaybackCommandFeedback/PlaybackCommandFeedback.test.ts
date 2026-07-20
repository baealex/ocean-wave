import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const ui = vi.hoisted(() => ({
    dismiss: vi.fn(),
    retry: vi.fn(),
    retryControllerReadiness: vi.fn(),
    state: {
        commandId: null as string | null,
        command: null as null | { type: string },
        targetEndpointId: null as string | null,
        targetDeviceName: null as string | null,
        phase: 'idle',
        message: null as string | null,
        error: null as null | {
            code: string;
            message: string;
            retryable: boolean;
        },
        controllerReady: true,
        controllerRefreshing: false,
        controllerMessage: null as string | null,
        controllerError: null as null | {
            code: string;
            message: string;
            retryable: boolean;
        }
    }
}));

vi.mock('~/store/base-store', () => ({
    useAppStore: (store: { state: object }) => [store.state, vi.fn()]
}));

vi.mock('~/store/remote-playback-control', () => ({
    isRemotePlaybackControlPending: (phase: string) => (
        [
            'sending',
            'accepted',
            'recovering',
            'reconciling',
            'refresh_error'
        ].includes(phase)
    ),
    remotePlaybackControlStore: {
        get state() {
            return ui.state;
        },
        dismiss: ui.dismiss,
        retry: ui.retry,
        retryControllerReadiness: ui.retryControllerReadiness
    }
}));

vi.mock('~/components/shared', () => ({
    Button: ({
        children,
        ...props
    }: {
        children?: ReactNode;
        [key: string]: unknown;
    }) => createElement('button', props, children),
    Text: ({
        as = 'span',
        children,
        ...props
    }: {
        as?: string;
        children?: ReactNode;
        [key: string]: unknown;
    }) => createElement(as, props, children)
}));

import PlaybackCommandFeedback from './PlaybackCommandFeedback';

const renderFeedback = () => renderToStaticMarkup(
    createElement(PlaybackCommandFeedback)
);

describe('PlaybackCommandFeedback', () => {
    beforeEach(() => {
        Object.assign(ui.state, {
            commandId: null,
            command: null,
            targetEndpointId: null,
            targetDeviceName: null,
            phase: 'idle',
            message: null,
            error: null,
            controllerReady: true,
            controllerRefreshing: false,
            controllerMessage: null,
            controllerError: null
        });
    });

    it('announces pending and completed commands without a retry action', () => {
        Object.assign(ui.state, {
            phase: 'accepted',
            message: 'Living Room Browser accepted Pause. Waiting for completion…'
        });
        const pendingMarkup = renderFeedback();
        expect(pendingMarkup).toContain('role="status"');
        expect(pendingMarkup).toContain('Accepted');
        expect(pendingMarkup).toContain('Waiting for completion');
        expect(pendingMarkup).not.toContain('Retry');
        expect(pendingMarkup).not.toContain('Dismiss');

        Object.assign(ui.state, {
            phase: 'completed',
            message: 'Living Room Browser completed Pause.'
        });
        const completedMarkup = renderFeedback();
        expect(completedMarkup).toContain('Completed');
        expect(completedMarkup).toContain('Dismiss playback command status');
    });

    it('announces retryable failures and exposes recovery actions', () => {
        Object.assign(ui.state, {
            phase: 'timed_out',
            message: 'The command outcome could not be confirmed.',
            error: {
                code: 'COMMAND_COMPLETION_TIMEOUT',
                message: 'The command outcome could not be confirmed.',
                retryable: true
            }
        });

        const markup = renderFeedback();
        expect(markup).toContain('role="alert"');
        expect(markup).toContain('aria-live="assertive"');
        expect(markup).toContain('Timed out');
        expect(markup).toContain('Retry');
        expect(markup).not.toContain('Retry refresh');
        expect(markup).toContain('Dismiss playback command status');
    });

    it('blocks dismissal while authoritative state needs to be refreshed', () => {
        Object.assign(ui.state, {
            phase: 'refresh_error',
            message: 'The latest playback state could not be confirmed.',
            error: {
                code: 'STATE_COMMIT_FAILED',
                message: 'The latest playback state could not be confirmed.',
                retryable: true
            }
        });

        const markup = renderFeedback();
        expect(markup).toContain('Refresh needed');
        expect(markup).toContain('Retry refresh');
        expect(markup).not.toContain('Dismiss playback command status');
    });

    it('surfaces controller readiness refresh progress and a retryable failure', () => {
        Object.assign(ui.state, {
            controllerReady: false,
            controllerRefreshing: true,
            controllerMessage: 'Refreshing playback control after registration…',
            controllerError: null
        });

        const pendingMarkup = renderFeedback();
        expect(pendingMarkup).toContain('Refreshing state');
        expect(pendingMarkup).not.toContain('Retry refresh');
        expect(pendingMarkup).not.toContain('Dismiss playback command status');

        Object.assign(ui.state, {
            controllerRefreshing: false,
            controllerMessage: 'Playback control state could not be refreshed.',
            controllerError: {
                code: 'STATE_COMMIT_FAILED',
                message: 'Playback control state could not be refreshed.',
                retryable: true
            }
        });

        const failedMarkup = renderFeedback();
        expect(failedMarkup).toContain('Refresh needed');
        expect(failedMarkup).toContain('Retry refresh');
        expect(failedMarkup).not.toContain('Dismiss playback command status');
    });

    it('does not offer refresh retry when registration recovery requires reload', () => {
        Object.assign(ui.state, {
            controllerReady: false,
            controllerRefreshing: false,
            controllerMessage: 'Playback endpoint capacity is full. Close another playback tab and reload.',
            controllerError: {
                code: 'TARGET_OFFLINE',
                message: 'Playback endpoint capacity is full. Close another playback tab and reload.',
                retryable: false
            }
        });

        const markup = renderFeedback();
        expect(markup).toContain('Close another playback tab and reload.');
        expect(markup).not.toContain('Retry refresh');
        expect(markup).not.toContain('Dismiss playback command status');
    });
});
