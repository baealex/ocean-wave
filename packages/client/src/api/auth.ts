import axios from 'axios';

export type AuthMode = 'open' | 'password';

export interface AuthSession {
    mode: AuthMode;
    authRequired: boolean;
    authenticated: boolean;
}

export async function getAuthSession() {
    const { data } = await axios.request<AuthSession>({
        url: '/api/auth/session',
        method: 'GET'
    });

    return data;
}

export async function logoutSession() {
    const { data } = await axios.request<AuthSession>({
        url: '/api/auth/logout',
        method: 'POST',
        data: {}
    });

    return data;
}
