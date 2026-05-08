import type { Controller } from '~/types';

import {
    buildAuthSessionResponse,
    clearAuthenticatedSession,
    compareSharedSecret,
    isAuthenticatedRequest,
    resolveRedirectPath,
    resolveAuthSessionResponse,
    setAuthenticatedSession
} from '~/modules/auth';
import type { AuthConfig } from '~/modules/auth-mode';

const INVALID_PASSWORD_RESPONSE = {
    code: 'UNAUTHORIZED',
    message: 'Invalid password'
} as const;

const escapeHtml = (value: string) => {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\'', '&#39;');
};

const renderLoginPage = (input: {
    redirectTo: string;
    errorMessage?: string;
}) => {
    const errorSection = input.errorMessage
        ? `<div class="error" role="alert">${escapeHtml(input.errorMessage)}</div>`
        : '';

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#09090b" />
    <title>Ocean Wave Sign In</title>
    <style>
        @font-face {
            font-family: "Pretendard";
            font-style: normal;
            font-weight: 400;
            font-display: swap;
            src: local("Pretendard Regular"), url("/fonts/Pretendard/Pretendard-Regular.woff2") format("woff2"), url("/fonts/Pretendard/Pretendard-Regular.woff") format("woff");
        }

        @font-face {
            font-family: "Pretendard";
            font-style: normal;
            font-weight: 700;
            font-display: swap;
            src: local("Pretendard Bold"), url("/fonts/Pretendard/Pretendard-Bold.woff2") format("woff2"), url("/fonts/Pretendard/Pretendard-Bold.woff") format("woff");
        }

        :root {
            color-scheme: dark;
            --bg: #09090b;
            --surface: #18181b;
            --surface-raised: #27272a;
            --surface-soft: rgba(244, 244, 245, 0.04);
            --border: rgba(244, 244, 245, 0.08);
            --text-primary: rgba(250, 250, 250, 0.94);
            --text-secondary: rgba(228, 228, 231, 0.72);
            --text-muted: rgba(161, 161, 170, 0.52);
            --primary: #8b5cf6;
            --primary-hover: #a78bfa;
            --primary-text: #09090b;
            --focus-ring: rgba(139, 92, 246, 0.2);
            --error-bg: rgba(78, 18, 22, 0.58);
            --error-border: rgba(247, 113, 113, 0.28);
            --error-text: #ffd9d9;
            font-family: "Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            min-height: 100dvh;
            display: grid;
            place-items: center;
            padding: 24px;
            background: var(--bg);
            color: var(--text-primary);
            overflow-x: hidden;
        }

        .shell {
            width: min(384px, 100%);
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
            color: var(--text-primary);
            font-size: 14px;
            font-weight: 700;
        }

        .mark {
            width: 44px;
            height: 44px;
            border: 1px solid var(--border);
            border-radius: 14px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            overflow: hidden;
            background: var(--surface-soft);
        }

        .mark img {
            width: 100%;
            height: 100%;
            display: block;
        }

        .brand-copy {
            display: grid;
            gap: 2px;
        }

        .brand-kicker {
            color: var(--primary);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
        }

        .panel {
            position: relative;
            padding: 28px;
            border: 1px solid var(--border);
            border-radius: 24px;
            background: var(--surface);
            overflow: hidden;
        }

        .panel::before {
            position: absolute;
            inset: 0 28px auto;
            height: 1px;
            background: linear-gradient(90deg, transparent, var(--primary), transparent);
            content: "";
        }

        h1 {
            margin: 0;
            color: var(--text-primary);
            font-size: clamp(1.75rem, 5vw, 2.25rem);
            line-height: 1.08;
            letter-spacing: -0.04em;
        }

        .lead {
            margin: 12px 0 0;
            color: var(--text-secondary);
            font-size: 14px;
            line-height: 1.6;
        }

        form {
            margin-top: 24px;
            display: grid;
            gap: 14px;
        }

        label {
            display: block;
            margin-bottom: 8px;
            color: var(--text-muted);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
        }

        input {
            width: 100%;
            min-height: 46px;
            padding: 0 14px;
            border: 1px solid var(--border);
            border-radius: 12px;
            background: var(--surface-raised);
            color: var(--text-primary);
            font-size: 16px;
            outline: none;
            transition: 150ms border-color, 150ms box-shadow, 150ms background-color;
        }

        input:focus {
            border-color: rgba(139, 92, 246, 0.46);
            background: #3f3f46;
            box-shadow: 0 0 0 3px var(--focus-ring);
        }

        input::placeholder {
            color: var(--text-muted);
        }

        button {
            width: 100%;
            min-height: 46px;
            padding: 0 16px;
            border: 0;
            border-radius: 12px;
            background: var(--primary);
            color: var(--primary-text);
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            transition: 150ms background-color;
        }

        button:hover {
            background: var(--primary-hover);
        }

        .error {
            margin-top: 20px;
            padding: 12px 14px;
            border: 1px solid var(--error-border);
            border-radius: 12px;
            background: var(--error-bg);
            color: var(--error-text);
            font-size: 14px;
            line-height: 1.45;
        }

        .hint {
            margin-top: 14px;
            color: var(--text-muted);
            font-size: 12px;
            line-height: 1.5;
        }

        @media (max-width: 640px) {
            body {
                padding: 16px;
            }

            .panel {
                padding: 22px;
            }
        }
    </style>
</head>
<body>
    <main class="shell">
        <div class="brand">
            <span class="mark" aria-hidden="true">
                <img src="/brand-logo.svg" alt="" />
            </span>
            <span class="brand-copy">
                <span class="brand-kicker">Private listening room</span>
                <span>Ocean Wave</span>
            </span>
        </div>
        <section class="panel" aria-labelledby="login-title">
            <h1 id="login-title">Sign in</h1>
            <p class="lead">Enter the Ocean Wave password to continue.</p>
            ${errorSection}
            <form method="post" action="/login">
                <input type="hidden" name="redirectTo" value="${escapeHtml(input.redirectTo)}" />
                <div>
                    <label for="password">Password</label>
                    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
                </div>
                <button type="submit">Sign in</button>
            </form>
            <div class="hint">The app opens after this session is authenticated.</div>
        </section>
    </main>
</body>
</html>`;
};

export const createSessionStatusHandler = (authConfig: AuthConfig): Controller => {
    return async (req, res) => {
        res.status(200).json(resolveAuthSessionResponse(authConfig, req)).end();
    };
};

export const createLoginPageHandler = (authConfig: AuthConfig): Controller => {
    return async (req, res) => {
        if (authConfig.mode !== 'password') {
            res.redirect(303, resolveRedirectPath(req.query.redirectTo));
            return;
        }

        const redirectTo = resolveRedirectPath(req.query.redirectTo);

        if (isAuthenticatedRequest(authConfig, req)) {
            res.redirect(303, redirectTo);
            return;
        }

        res
            .status(200)
            .type('html')
            .send(renderLoginPage({ redirectTo }))
            .end();
    };
};

export const createLoginPageSubmitHandler = (authConfig: AuthConfig): Controller => {
    return async (req, res) => {
        const redirectTo = resolveRedirectPath(req.body?.redirectTo);

        if (authConfig.mode !== 'password') {
            res.redirect(303, redirectTo);
            return;
        }

        const password = typeof req.body?.password === 'string'
            ? req.body.password
            : '';

        if (!password || !compareSharedSecret(authConfig.password, password)) {
            res
                .status(401)
                .type('html')
                .send(renderLoginPage({
                    redirectTo,
                    errorMessage: INVALID_PASSWORD_RESPONSE.message
                }))
                .end();
            return;
        }

        setAuthenticatedSession(authConfig, res);
        res.redirect(303, redirectTo);
    };
};

export const createLogoutPageHandler = (authConfig: AuthConfig): Controller => {
    return async (_req, res) => {
        clearAuthenticatedSession(authConfig, res);
        res.redirect(303, authConfig.mode === 'password' ? '/login' : '/');
    };
};


export const createApiLoginHandler = (authConfig: AuthConfig): Controller => {
    return async (req, res) => {
        if (authConfig.mode !== 'password') {
            res.status(200).json(buildAuthSessionResponse(authConfig, false)).end();
            return;
        }

        const password = typeof req.body?.password === 'string'
            ? req.body.password
            : '';

        if (!password || !compareSharedSecret(authConfig.password, password)) {
            res.status(401).json(INVALID_PASSWORD_RESPONSE).end();
            return;
        }

        setAuthenticatedSession(authConfig, res);
        res.status(200).json(buildAuthSessionResponse(authConfig, true)).end();
    };
};

export const createApiLogoutHandler = (authConfig: AuthConfig): Controller => {
    return async (_req, res) => {
        clearAuthenticatedSession(authConfig, res);
        res.status(200).json(buildAuthSessionResponse(authConfig, false)).end();
    };
};
