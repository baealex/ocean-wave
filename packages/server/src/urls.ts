import { Router } from 'express';
import * as views from './views';
import { requireAuthenticatedRequest } from './modules/auth';
import type { AuthConfig } from './modules/auth-mode';
import useAsync from './modules/use-async';

export const createApiRouter = (authConfig: AuthConfig) => {
    return Router()
        .get('/auth/session', useAsync(views.createSessionStatusHandler(authConfig)))
        .post('/auth/login', useAsync(views.createApiLoginHandler(authConfig)))
        .post('/auth/logout', useAsync(views.createApiLogoutHandler(authConfig)))
        .use('/auth', (_req, res) => {
            res.status(404).json({ message: 'Not Found' }).end();
        })
        .use(requireAuthenticatedRequest(authConfig))
        .get('/audio/:id', useAsync(views.audio))
        .get('/home', useAsync(views.home));
};

export default createApiRouter;
