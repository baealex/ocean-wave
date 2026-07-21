import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { MusicMetadataOperation } from '~/api/music';

import MusicMetadataOperationNotice from './MusicMetadataOperationNotice';

const failedOperation: MusicMetadataOperation = {
    operationId: 'operation-7',
    status: 'rolled-back',
    retryable: true,
    errorCode: 'AUDIO_METADATA_WRITE_FAILED',
    errorMessage: 'Every changed file was restored.',
    music: null,
    targets: [{
        fileId: 'file-1',
        filePath: 'library/track.flac',
        status: 'restored',
        errorCode: null,
        errorMessage: null
    }],
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:01:00.000Z'
};

describe('MusicMetadataOperationNotice', () => {
    it('shows a retryable rollback with the affected file and recovery message', () => {
        const markup = renderToStaticMarkup(createElement(MusicMetadataOperationNotice, {
            operation: failedOperation,
            onRecover: vi.fn(),
            onRetry: vi.fn()
        }));

        expect(markup).toContain('Metadata update needs attention');
        expect(markup).toContain('Every changed file was restored.');
        expect(markup).toContain('library/track.flac');
        expect(markup).toContain('Retry metadata update');
    });

    it('shows a recovery action when committed files still need journal cleanup', () => {
        const markup = renderToStaticMarkup(createElement(MusicMetadataOperationNotice, {
            operation: {
                ...failedOperation,
                status: 'committed',
                retryable: false,
                errorCode: 'AUDIO_METADATA_CLEANUP_FAILED',
                errorMessage: 'Backup cleanup must be retried.'
            },
            onRecover: vi.fn(),
            onRetry: vi.fn()
        }));

        expect(markup).toContain('Backup cleanup must be retried.');
        expect(markup).toContain('Recover files');
        expect(markup).not.toContain('Retry metadata update');
    });
});
