import type { Request, Response } from 'express';
import { createLibraryBackup, inspectLibraryRestore, restoreLibraryBackup } from '~/features/library-backup/library-backup';

export const downloadLibraryBackup = async (_req: Request, res: Response) => {
    const backup = await createLibraryBackup();
    res.type('application/json').setHeader('Content-Disposition', `attachment; filename="ocean-wave-backup-${backup.createdAt.slice(0, 10)}.json"`);
    res.send(JSON.stringify(backup, null, 2));
};

export const previewLibraryRestore = async (req: Request, res: Response) => {
    if (typeof req.body.content !== 'string') { res.status(400).json({ message: 'Backup content is required.' }); return; }
    res.json(await inspectLibraryRestore(req.body.content));
};

export const applyLibraryRestore = async (req: Request, res: Response) => {
    if (typeof req.body.content !== 'string' || !['merge', 'replace'].includes(req.body.mode)) { res.status(400).json({ message: 'Backup content and a restore mode are required.' }); return; }
    res.json(await restoreLibraryBackup(req.body.content, req.body.mode));
};
