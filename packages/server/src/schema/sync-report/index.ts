import type { IResolvers } from '@graphql-tools/utils';

import models from '~/models';
import { gql } from '~/modules/graphql';
import { SYNC_REPORT_KIND } from '~/modules/sync-report';

export const syncReportType = gql`
    type SyncReportItem {
        id: ID!
        kind: String!
        musicId: ID
        musicName: String!
        filePath: String!
        previousFilePath: String
        createdAt: String!
    }

    type SyncReport {
        id: ID!
        createdAt: String!
        startedAt: String!
        completedAt: String
        status: String!
        force: Boolean!
        scannedFiles: Int!
        indexedFiles: Int!
        createdCount: Int!
        movedCount: Int!
        duplicateCount: Int!
        missingCount: Int!
        created: [SyncReportItem!]!
        moved: [SyncReportItem!]!
        duplicate: [SyncReportItem!]!
        missing: [SyncReportItem!]!
    }
`;

export const syncReportQuery = gql`
    type Query {
        latestSyncReport: SyncReport
    }
`;

export const syncReportTypeDefs = `
    ${syncReportType}
    ${syncReportQuery}
`;

const filterItemsByKind = (
    kind: string,
    items: Array<{ kind: string }> = []
) => items.filter((item) => item.kind === kind);

export const syncReportResolvers: IResolvers = {
    Query: {
        latestSyncReport: () => models.syncReport.findFirst({
            orderBy: { createdAt: 'desc' },
            include: { Item: { orderBy: { id: 'asc' } } }
        })
    },
    SyncReport: {
        created: (report: { Item?: Array<{ kind: string }> }) => {
            return filterItemsByKind(SYNC_REPORT_KIND.created, report.Item);
        },
        moved: (report: { Item?: Array<{ kind: string }> }) => {
            return filterItemsByKind(SYNC_REPORT_KIND.moved, report.Item);
        },
        duplicate: (report: { Item?: Array<{ kind: string }> }) => {
            return filterItemsByKind(SYNC_REPORT_KIND.duplicate, report.Item);
        },
        missing: (report: { Item?: Array<{ kind: string }> }) => {
            return filterItemsByKind(SYNC_REPORT_KIND.missing, report.Item);
        }
    },
    SyncReportItem: {
        musicId: async (item: { musicId: number | null }) => {
            if (!item.musicId) return null;

            const file = await models.physicalFile.findUnique({
                where: { id: item.musicId },
                select: { releaseTrackId: true }
            });
            return file?.releaseTrackId ?? null;
        }
    }
};
