import fs from 'node:fs/promises';
import type { Request, Response } from 'express';
import models from '~/models';
import { transcodePool } from '~/modules/audio-streaming';
import { resolveMusicFilePath } from '~/modules/storage-paths';
import { connectors } from '~/socket/connectors';

export const connectivityDiagnostics = async (_req: Request, res: Response) => {
    const startedAt = performance.now();
    const file = await models.physicalFile.findFirst({ where: { syncStatus: 'active' }, orderBy: { id: 'asc' } });
    let streamReadable = false;
    if (file) {
        try { await fs.access(resolveMusicFilePath(file.filePath)); streamReadable = true; } catch { streamReadable = false; }
    }
    res.json({
        authenticated: true,
        rangeRequests: true,
        socketConnections: connectors.get().length,
        streamReadable,
        responsePreparationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        transcodes: transcodePool.status,
        serverTime: new Date().toISOString()
    });
};
