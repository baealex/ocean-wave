import classNames from 'classnames';
import { cva } from 'class-variance-authority';
import { Suspense, useEffect, useRef } from 'react';
import {
    Outlet,
    useLocation,
    useMatches,
    useSearchParams
} from 'react-router-dom';

import SiteHeader from '../shared/SiteHeader';
import SubPageHeader from '../shared/SubPageHeader';
import MusicPlayer from '../music/MusicPlayer';
import Loading from '../shared/Loading';
import PageContainer from '../shared/PageContainer';
import type { PageContainerProps } from '../shared/PageContainer';
import PanelProvider from '../app/PanelProvider';
import ToastProvider from '../app/ToastProvider';
import {
    isSubPagePath,
    resolveSubPagePresentation,
    shouldHideMiniPlayer,
    shouldRenderSubPageHeader
} from '~/modules/sub-page-presentation';

const cx = classNames;

type SubPagePresentation = ReturnType<typeof resolveSubPagePresentation>;
type PageFrameConfig = Omit<PageContainerProps, 'children'>;

interface RouteHandle {
    pageFrame?: PageFrameConfig;
}

const siteContentClass = cva('relative flex min-h-0 flex-1 overflow-hidden', {
    variants: {
        subPage: {
            true: 'lg:col-[1/3]',
            false: ''
        }
    },
    defaultVariants: {
        subPage: false
    }
});

const subPageBackdropClass = cva('pointer-events-none absolute inset-0 bg-[var(--b-color-overlay-strong)] lg:hidden', {
    variants: {
        hidden: {
            true: 'hidden',
            false: ''
        }
    },
    defaultVariants: {
        hidden: false
    }
});

const subPageFrameClass: Record<SubPagePresentation, string> = {
    stacked: 'pt-0',
    sheet: 'pt-3.5 lg:pt-0',
    fullscreen: 'pt-0 bg-[var(--b-gradient-subpage-fullscreen)] lg:bg-transparent'
};

const subPageSurfaceClass: Record<SubPagePresentation, string> = {
    stacked: '',
    sheet: 'rounded-t-[var(--b-radius-xl)] lg:rounded-none',
    fullscreen: 'border-t-0 bg-transparent opacity-100 shadow-none lg:flex lg:w-full lg:grid-cols-none'
};

const subPageContentClass: Record<SubPagePresentation, string> = {
    stacked: '',
    sheet: '',
    fullscreen: 'flex flex-1 w-full min-w-0 overflow-hidden bg-transparent'
};

const resolvePageFrame = (matches: ReturnType<typeof useMatches>): PageFrameConfig | null => {
    for (const match of [...matches].reverse()) {
        const handle = match.handle as RouteHandle | undefined;

        if (handle?.pageFrame) {
            return handle.pageFrame;
        }
    }

    return null;
};

interface SiteLayoutProps {
    disablePlayer?: boolean;
}

export default function SiteLayout({ disablePlayer = false }: SiteLayoutProps) {
    const location = useLocation();
    const matches = useMatches();
    const [searchParams, setSearchParams] = useSearchParams();

    const containerRef = useRef<HTMLDivElement>(null);
    const shouldBeScroll = useRef(true);
    const setSearchParamsRef = useRef(setSearchParams);
    const isSubPage = isSubPagePath(location.pathname);
    const subPagePresentation = resolveSubPagePresentation(location.pathname);
    const hasSubPageHeader = shouldRenderSubPageHeader(location.pathname);
    const hideMiniPlayer = shouldHideMiniPlayer(location.pathname);
    const shouldAvoidMiniPlayerForToast = !disablePlayer && !hideMiniPlayer;
    const hasMiniPlayer = !disablePlayer && !hideMiniPlayer;
    const pageFrame = resolvePageFrame(matches);

    const renderOutlet = () => {
        const outlet = (
            <Suspense fallback={<Loading />}>
                <Outlet />
            </Suspense>
        );

        return pageFrame
            ? <PageContainer {...pageFrame}>{outlet}</PageContainer>
            : outlet;
    };

    useEffect(() => {
        setSearchParamsRef.current = setSearchParams;
    });

    useEffect(() => {
        if (containerRef.current && shouldBeScroll.current) {
            containerRef.current.scrollTop = parseInt(searchParams.get('py') || '0');
            shouldBeScroll.current = false;
        }
        return () => {
            shouldBeScroll.current = true;
        };
    }, [containerRef, isSubPage, shouldBeScroll, location.pathname, searchParams]);

    useEffect(() => {
        if (!containerRef.current) {
            return;
        }

        let timer: ReturnType<typeof setTimeout> | null = null;

        const handleScroll = () => {
            if (timer) {
                clearTimeout(timer);
            }

            timer = setTimeout(() => {
                setSearchParamsRef.current((currentSearchParams) => {
                    const nextSearchParams = new URLSearchParams(currentSearchParams);
                    nextSearchParams.set('py', containerRef.current?.scrollTop.toString() || '0');
                    return nextSearchParams;
                }, { replace: true });
            }, 200);
        };

        containerRef.current.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            if (timer) {
                clearTimeout(timer);
            }
            containerRef.current?.removeEventListener('scroll', handleScroll);
        };
    }, [containerRef, isSubPage, location.pathname]);

    return (
        <PanelProvider>
            <main>
            {!isSubPage && <SiteHeader />}
            <div className={siteContentClass({ subPage: isSubPage })}>
                {!isSubPage && (
                    <div
                        ref={containerRef}
                        className={cx(
                            'main-container min-h-0 w-full min-w-0 flex-1',
                            hasMiniPlayer && 'pb-[var(--app-mini-player-content-offset)] lg:pb-[var(--app-mini-player-content-offset-lg)]'
                        )}>
                        {renderOutlet()}
                    </div>
                )}
                {isSubPage && (
                    <div
                        className={cx(
                            'absolute inset-0 z-[2] flex min-h-0 flex-1 overflow-hidden p-0',
                            subPageFrameClass[subPagePresentation]
                        )}>
                        <div className={subPageBackdropClass({ hidden: subPagePresentation === 'fullscreen' })} />
                        <div
                            key={location.pathname}
                            className={cx(
                                'relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-t border-[var(--b-color-border-subtle)] bg-[var(--b-gradient-layer)] shadow-none lg:grid lg:grid-cols-[256px_minmax(0,1fr)] lg:border-t-0 lg:bg-transparent',
                                subPageSurfaceClass[subPagePresentation]
                            )}>
                            {hasSubPageHeader ? (
                                <>
                                    <SubPageHeader />
                                    <div
                                        ref={containerRef}
                                        className={cx(
                                            'main-container min-h-0 bg-[var(--b-gradient-subpage-content)] lg:bg-transparent',
                                            subPageContentClass[subPagePresentation]
                                        )}>
                                        {renderOutlet()}
                                    </div>
                                </>
                            ) : (
                                <div className={cx('min-h-0 bg-[var(--b-gradient-subpage-content)] lg:bg-transparent', subPageContentClass[subPagePresentation])}>
                                    {renderOutlet()}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
            {hasMiniPlayer && <MusicPlayer />}
            <ToastProvider avoidMiniPlayer={shouldAvoidMiniPlayerForToast} />
            </main>
        </PanelProvider>
    );
}
