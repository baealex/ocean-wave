import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import AuthGate from '~/components/auth/AuthGate';
import { getAuthSession } from '~/api/auth';
import { queryKeys } from '~/api/query-keys';
import {
    redirectToLogin,
    shouldRedirectToLogin
} from '~/modules/auth-redirect';

interface AuthSessionBoundaryProps {
    children: React.ReactNode;
}

export default function AuthSessionBoundary({
    children
}: AuthSessionBoundaryProps) {
    const authSessionQuery = useQuery({
        queryKey: queryKeys.auth.session(),
        queryFn: getAuthSession,
        staleTime: 30_000
    });

    const authSession = authSessionQuery.data;
    const isAuthLoading = authSessionQuery.isLoading || authSessionQuery.isFetching;
    const canAccessApp = Boolean(
        authSession && (!authSession.authRequired || authSession.authenticated)
    );

    useEffect(() => {
        const interceptorId = axios.interceptors.response.use(
            (response) => response,
            async (error) => {
                if (shouldRedirectToLogin(error)) {
                    redirectToLogin();
                }

                return Promise.reject(error);
            }
        );

        return () => {
            axios.interceptors.response.eject(interceptorId);
        };
    }, []);

    useEffect(() => {
        if (isAuthLoading || !authSession) {
            return;
        }

        if (authSession.authRequired && !authSession.authenticated) {
            redirectToLogin();
        }
    }, [authSession, isAuthLoading]);

    if (!isAuthLoading && !authSession) {
        return (
            <AuthGate
                state="error"
                errorMessage="Unable to verify the current session. Retry once the server is reachable."
                onRetry={() => {
                    void authSessionQuery.refetch();
                }}
            />
        );
    }

    if (!isAuthLoading && authSession?.authRequired && !authSession.authenticated) {
        return <AuthGate state="loading" />;
    }

    if (canAccessApp) {
        return children;
    }

    return null;
}
