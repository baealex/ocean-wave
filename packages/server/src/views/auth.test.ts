import request from 'supertest';

import { createApp } from '~/app';
import { AUTH_SESSION_COOKIE_NAME, type AuthConfig } from '~/modules/auth-mode';

const openAuthConfig: AuthConfig = {
    mode: 'open',
    source: 'explicit-open',
    cookieName: AUTH_SESSION_COOKIE_NAME
};

const passwordAuthConfig: AuthConfig = {
    mode: 'password',
    source: 'password',
    cookieName: AUTH_SESSION_COOKIE_NAME,
    password: 'secret',
    sessionSecret: 'session-secret'
};

describe('auth http flow', () => {
    it('uses only the canonical auth routes in open mode', async () => {
        const app = createApp(openAuthConfig);

        const session = await request(app).get('/api/auth/session');
        expect(session.status).toBe(200);
        expect(session.body).toEqual({
            mode: 'open',
            authRequired: false,
            authenticated: false
        });

        const loginPage = await request(app).get('/login?redirectTo=%2Flibrary');
        expect(loginPage.status).toBe(303);
        expect(loginPage.headers.location).toBe('/library');

        const loginSubmit = await request(app)
            .post('/login')
            .type('form')
            .send({ password: 'secret', redirectTo: '/library' });

        expect(loginSubmit.status).toBe(303);
        expect(loginSubmit.headers.location).toBe('/library');

        const logout = await request(app)
            .post('/logout')
            .type('form')
            .send({});

        expect(logout.status).toBe(303);
        expect(logout.headers.location).toBe('/');

        const apiLogin = await request(app)
            .post('/api/auth/login')
            .send({ password: 'secret' });

        expect(apiLogin.status).toBe(200);
        expect(apiLogin.body).toEqual({
            mode: 'open',
            authRequired: false,
            authenticated: false
        });
    });

    it('serves a server-owned login page and gates protected html routes in password mode', async () => {
        const app = createApp(passwordAuthConfig);
        const agent = request.agent(app);

        const protectedHtml = await agent.get('/?tab=queue');
        expect(protectedHtml.status).toBe(303);
        expect(protectedHtml.headers.location).toBe('/login?redirectTo=%2F%3Ftab%3Dqueue');

        const loginPage = await agent.get('/login?redirectTo=%2Fplaylist%2F7');
        expect(loginPage.status).toBe(200);
        expect(loginPage.headers['content-type']).toContain('text/html');
        expect(loginPage.text).toContain('<form method="post" action="/login">');
        expect(loginPage.text).toContain('name="redirectTo" value="/playlist/7"');
        expect(loginPage.text).toContain('Enter the Ocean Wave password to continue.');
        expect(loginPage.text).toContain('The app opens after this session is authenticated.');
        expect(loginPage.text).toContain('Sign in');

        const wrongPassword = await agent
            .post('/login')
            .type('form')
            .send({ password: 'wrong', redirectTo: '/playlist/7' });

        expect(wrongPassword.status).toBe(401);
        expect(wrongPassword.headers['content-type']).toContain('text/html');
        expect(wrongPassword.text).toContain('Invalid password');

        const login = await agent
            .post('/login')
            .type('form')
            .send({ password: 'secret', redirectTo: '/playlist/7' });

        expect(login.status).toBe(303);
        expect(login.headers.location).toBe('/playlist/7');

        const authenticatedSession = await agent.get('/api/auth/session');
        expect(authenticatedSession.status).toBe(200);
        expect(authenticatedSession.body).toEqual({
            mode: 'password',
            authRequired: true,
            authenticated: true
        });

        const authenticatedLoginPage = await agent.get('/login?redirectTo=%2Fplaylist%2F7');
        expect(authenticatedLoginPage.status).toBe(303);
        expect(authenticatedLoginPage.headers.location).toBe('/playlist/7');

        const authenticatedHome = await agent.get('/api/home');
        expect(authenticatedHome.status).toBe(200);
        expect(authenticatedHome.text).toContain('Hello, My Express JS!');

        const authenticatedGraphql = await agent
            .post('/graphql')
            .send({ query: 'query { __typename }' });

        expect(authenticatedGraphql.status).toBe(200);
        expect(authenticatedGraphql.body.data.__typename).toBe('Query');

        const logoutPage = await agent
            .post('/logout')
            .type('form')
            .send({});

        expect(logoutPage.status).toBe(303);
        expect(logoutPage.headers.location).toBe('/login');

        const postLogoutHome = await agent.get('/api/home');
        expect(postLogoutHome.status).toBe(401);
        expect(postLogoutHome.body.code).toBe('UNAUTHORIZED');
    });

    it('supports json login for mobile clients and keeps logout api routes', async () => {
        const app = createApp(passwordAuthConfig);
        const agent = request.agent(app);

        const wrongApiLogin = await agent
            .post('/api/auth/login')
            .send({ password: 'wrong' });

        expect(wrongApiLogin.status).toBe(401);
        expect(wrongApiLogin.body).toEqual({
            code: 'UNAUTHORIZED',
            message: 'Invalid password'
        });

        const apiLogin = await agent
            .post('/api/auth/login')
            .send({ password: 'secret' });

        expect(apiLogin.status).toBe(200);
        expect(apiLogin.body).toEqual({
            mode: 'password',
            authRequired: true,
            authenticated: true
        });
        expect(apiLogin.headers['set-cookie']?.[0]).toContain(AUTH_SESSION_COOKIE_NAME);

        const authenticatedGraphql = await agent
            .post('/graphql')
            .send({ query: 'query { __typename }' });

        expect(authenticatedGraphql.status).toBe(200);
        expect(authenticatedGraphql.body.data.__typename).toBe('Query');

        const login = await agent
            .post('/login')
            .type('form')
            .send({
                password: 'secret',
                redirectTo: 'https://evil.example/path'
            });

        expect(login.status).toBe(303);
        expect(login.headers.location).toBe('/');

        const apiLogout = await agent
            .post('/api/auth/logout')
            .send({});

        expect(apiLogout.status).toBe(200);
        expect(apiLogout.body).toEqual({
            mode: 'password',
            authRequired: true,
            authenticated: false
        });
    });
});
