import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import svgr from 'vite-plugin-svgr';
import { defineConfig } from 'vitest/config';

const vendorModules = [
    'react',
    'react-dom',
    'react-router-dom',
    'react-router',
    '@tanstack/react-query',
    '@dnd-kit/core',
    '@dnd-kit/sortable',
    '@dnd-kit/modifiers',
    '@dnd-kit/utilities'
];
const serverOrigin = process.env.OCEAN_WAVE_SERVER_ORIGIN ?? 'http://localhost:44100';

function getManualChunk(id: string) {
    const normalizedId = id.replaceAll('\\', '/');
    if (!normalizedId.includes('/node_modules/')) return undefined;

    if (vendorModules.some((moduleName) => normalizedId.includes(`/node_modules/${moduleName}/`))) {
        return 'vendor';
    }

    return undefined;
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        svgr(),
        tailwindcss()
    ],
    resolve: { alias: { '~': path.resolve(__dirname, './src') } },
    build: {
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks: getManualChunk
            }
        }
    },
    server: {
        host: '0.0.0.0',
        proxy: {
            '/api': { target: serverOrigin },
            '/cache': { target: serverOrigin },
            '/graphql': { target: serverOrigin },
            '/login': { target: serverOrigin },
            '/logout': { target: serverOrigin },
            '/socket.io': {
                target: serverOrigin,
                ws: true,
                onProxyReqWs: (proxyReq) => {
                    proxyReq.setHeader('Origin', serverOrigin);
                }
            }
        }
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        setupFiles: ['./src/test/setup.ts']
    }
});
