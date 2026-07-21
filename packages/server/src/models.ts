import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import {
    createCompatibilityDelegates,
    type CompatibilityAlbumDelegate,
    type CompatibilityMusicDelegate
} from './models/music-compatibility';

const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? 'file:./prisma/data/db.sqlite3'
});

const prisma = new PrismaClient({
    adapter
});

type CompatibilityPrismaClient = Omit<PrismaClient, 'album' | 'music'> & {
    album: CompatibilityAlbumDelegate;
    music: CompatibilityMusicDelegate;
};

const compatibility = createCompatibilityDelegates(prisma);
const models = new Proxy(prisma, {
    get: (target, property, receiver) => {
        if (property === 'album') return compatibility.album;
        if (property === 'music') return compatibility.music;

        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
    }
}) as CompatibilityPrismaClient;

export default models;
export * from '@prisma/client';
