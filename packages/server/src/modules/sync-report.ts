export const SYNC_REPORT_STATUS = {
    success: 'success',
    error: 'error'
} as const;

export type SyncReportStatus = typeof SYNC_REPORT_STATUS[keyof typeof SYNC_REPORT_STATUS];

export const SYNC_REPORT_KIND = {
    created: 'created',
    moved: 'moved',
    duplicate: 'duplicate',
    missing: 'missing',
    reconcile: 'reconcile'
} as const;

export type SyncReportKind = typeof SYNC_REPORT_KIND[keyof typeof SYNC_REPORT_KIND];
