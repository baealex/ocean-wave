type MobilePlayTarget = 'music' | 'playlist';

interface OpenMobilePlayLinkOptions {
    fallbackDelayMs?: number;
    onFallback?: () => void;
}

export function createMobilePlayLink(target: MobilePlayTarget, id: string | number) {
    const server = encodeURIComponent(window.location.origin);
    return `oceanwave://play/${target}/${id}?server=${server}`;
}

export function openMobilePlayLink(target: MobilePlayTarget, id: string | number, options: OpenMobilePlayLinkOptions = {}) {
    const { fallbackDelayMs = 2500, onFallback } = options;
    const openedAt = Date.now();

    window.location.href = createMobilePlayLink(target, id);

    if (!onFallback) return;

    window.setTimeout(() => {
        const likelyStillOnPage = document.visibilityState === 'visible' && Date.now() - openedAt >= fallbackDelayMs;
        if (likelyStillOnPage) {
            onFallback();
        }
    }, fallbackDelayMs);
}
