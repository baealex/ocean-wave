import fs from 'fs';
import childProcess from 'child_process';
import path from 'path';
import { loadEnvFile } from 'node:process';

import {
    finalizeMusicRelationshipMigration,
    prepareMusicRelationshipMigration
} from './music-relationship-migration';

const prismaPath = path.resolve(__dirname, '../prisma');
const packagePath = path.resolve(__dirname, '..');
type MigrationMode = 'dev' | 'deploy';

export const createDatabase = async (mode: MigrationMode = 'dev') => {
    if (!process.env.DATABASE_URL) {
        try {
            loadEnvFile(path.resolve(packagePath, '.env'));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
    }

    const preparation = await prepareMusicRelationshipMigration({
        databaseUrl: process.env.DATABASE_URL ?? 'file:./prisma/data/db.sqlite3',
        baseDirectory: packagePath
    });

    if (preparation.backupPath) {
        console.log(
            `Verified pre-migration database backup: ${preparation.backupPath}`
        );
    }

    try {
        childProcess.execSync(`pnpm exec prisma migrate ${mode}`, {
            stdio: 'inherit',
        });
        finalizeMusicRelationshipMigration(preparation);
    } catch (error) {
        if (preparation.backupPath && preparation.databasePath) {
            console.error([
                'The music relationship migration did not complete.',
                `The verified source backup remains at: ${preparation.backupPath}`,
                `Do not overwrite the database at: ${preparation.databasePath}`,
                'Follow docs/process/MUSIC_RELATIONSHIP_MIGRATION.md before retrying.'
            ].join('\n'));
        }
        throw error;
    }
};

export const removeDatabase = async (fileName = 'db.sqlite3') => {
    const databasePaths = [
        path.resolve(packagePath, fileName),
        path.resolve(prismaPath, fileName)
    ];

    for (const databasePath of databasePaths) {
        if (fs.existsSync(databasePath)) {
            fs.unlinkSync(databasePath);
        }
    }
};
