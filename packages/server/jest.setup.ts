import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { createCompatibilityDelegates } from './src/models/music-compatibility';

const adapter = new PrismaBetterSqlite3({
    url: 'file:test.sqlite3'
});

const mockPrisma = new PrismaClient({
    adapter
});

const mockCompatibility = createCompatibilityDelegates(mockPrisma);
const mockModels = new Proxy(mockPrisma, {
    get: (target, property, receiver) => {
        if (property === 'album') return mockCompatibility.album;
        if (property === 'music') return mockCompatibility.music;

        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
    }
});

jest.mock('~/models', () => mockModels);

beforeAll(async () => {
    await mockPrisma.$connect();
});

afterAll(async () => {
    await mockPrisma.$disconnect();
});
