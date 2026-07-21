import http from 'http';
import { Server } from 'socket.io';

import { createApp } from './app';
import { recoverMusicMetadataOperationJournals } from './features/music/services/metadata-operation-recovery';
import { requireAuthenticatedSocketConnection } from './modules/auth';
import { logAuthConfig, resolveAuthConfig } from './modules/auth-mode';
import { socketManager } from './socket';

const DEFAULT_PORT = 44100;

const main = async () => {
    await recoverMusicMetadataOperationJournals();

    const authConfig = resolveAuthConfig(process.env);
    logAuthConfig(authConfig);

    const app = createApp(authConfig);
    const server = http.createServer(app);
    const io = new Server(server);
    io.use(requireAuthenticatedSocketConnection(authConfig));
    io.on('connection', socketManager);

    const port = process.env.PORT || DEFAULT_PORT;
    server.listen(port, () => {
        process.stdout.write(`http server listen on:${port} (auth: ${authConfig.mode}) \n`);
    });
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
