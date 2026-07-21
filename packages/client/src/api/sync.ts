import type {
    SyncReport,
    SyncReportItem
} from '~/models/type';

import { createQuery, graphQLRequest, wrapper } from './graphql';

export function getLatestSyncReport() {
    return graphQLRequest<'latestSyncReport', SyncReport | null>({
        operationName: 'LatestSyncReport',
        query: wrapper('query LatestSyncReport', createQuery<SyncReport>('latestSyncReport', [
            'id',
            'createdAt',
            'startedAt',
            'completedAt',
            'status',
            'force',
            'scannedFiles',
            'indexedFiles',
            'createdCount',
            'movedCount',
            'duplicateCount',
            'missingCount',
            'reconcileCount',
            createQuery<SyncReportItem>('created', [
                'id',
                'kind',
                'musicId',
                'musicName',
                'filePath',
                'previousFilePath',
                'createdAt'
            ]),
            createQuery<SyncReportItem>('moved', [
                'id',
                'kind',
                'musicId',
                'musicName',
                'filePath',
                'previousFilePath',
                'createdAt'
            ]),
            createQuery<SyncReportItem>('duplicate', [
                'id',
                'kind',
                'musicId',
                'musicName',
                'filePath',
                'previousFilePath',
                'createdAt'
            ]),
            createQuery<SyncReportItem>('missing', [
                'id',
                'kind',
                'musicId',
                'musicName',
                'filePath',
                'previousFilePath',
                'createdAt'
            ]),
            createQuery<SyncReportItem>('reconcile', [
                'id',
                'kind',
                'musicId',
                'musicName',
                'filePath',
                'previousFilePath',
                'createdAt'
            ])
        ]))
    });
}
