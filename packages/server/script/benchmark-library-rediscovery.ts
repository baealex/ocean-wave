import { performance } from 'node:perf_hooks';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import {
    DEFAULT_LIBRARY_REDISCOVERY_LIMIT,
    getLibraryRediscovery
} from '../src/features/music/services/library-rediscovery';

const positiveInteger = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const percentile = (values: number[], ratio: number) => {
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(Math.ceil(sorted.length * ratio) - 1, sorted.length - 1);

    return sorted[Math.max(index, 0)];
};

const main = async () => {
    const adapter = new PrismaBetterSqlite3({
        url: process.env.DATABASE_URL ?? 'file:./prisma/data/db.sqlite3'
    });
    const database = new PrismaClient({
        adapter,
        log: [{ emit: 'event', level: 'query' }]
    });
    const limit = positiveInteger(
        process.env.REDISCOVERY_BENCHMARK_LIMIT,
        DEFAULT_LIBRARY_REDISCOVERY_LIMIT
    );
    const runs = positiveInteger(process.env.REDISCOVERY_BENCHMARK_RUNS, 5);
    let queryCount = 0;
    database.$on('query', () => {
        queryCount += 1;
    });

    try {
        await getLibraryRediscovery({ database, limit });
        const durations: number[] = [];
        const queryCounts: number[] = [];
        let latest = await getLibraryRediscovery({ database, limit });

        for (let run = 0; run < runs; run += 1) {
            queryCount = 0;
            const startedAt = performance.now();
            latest = await getLibraryRediscovery({ database, limit });
            durations.push(performance.now() - startedAt);
            queryCounts.push(queryCount);
        }

        console.log(JSON.stringify({
            candidatePoolSize: latest.metrics.candidatePoolSize,
            eligibleMusicCount: latest.eligibleMusicCount,
            limit,
            logicalQueryCount: latest.metrics.logicalQueryCount,
            maximumDurationMs: Number(Math.max(...durations).toFixed(2)),
            medianDurationMs: Number(percentile(durations, 0.5).toFixed(2)),
            p95DurationMs: Number(percentile(durations, 0.95).toFixed(2)),
            runs,
            sourcePoolLimit: latest.metrics.sourcePoolLimit,
            sqlQueryCounts: queryCounts
        }, null, 2));
    } finally {
        await database.$disconnect();
    }
};

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
