export type SubPagePresentation = 'stacked' | 'sheet' | 'fullscreen';

const SHEET_ROUTES = new Set<string>();

const FULLSCREEN_ROUTES = new Set([
    '/player',
    '/queue'
]);

const SUB_PAGE_PATTERNS = [
    /^\/album\/[^/]+$/,
    /^\/artist\/[^/]+$/,
    /^\/playlist\/[^/]+$/,
    /^\/music\/[^/]+\/edit$/,
    /^\/player$/,
    /^\/queue$/
];

export const isSubPagePath = (pathname: string) => {
    return SUB_PAGE_PATTERNS.some(pattern => pattern.test(pathname));
};

export const shouldRenderSubPageHeader = (pathname: string) => {
    return !FULLSCREEN_ROUTES.has(pathname);
};

export const shouldHideMiniPlayer = (pathname: string) => {
    return FULLSCREEN_ROUTES.has(pathname);
};

export const resolveSubPagePresentation = (pathname: string): SubPagePresentation => {
    if (FULLSCREEN_ROUTES.has(pathname)) {
        return 'fullscreen';
    }

    if (SHEET_ROUTES.has(pathname)) {
        return 'sheet';
    }

    return 'stacked';
};
