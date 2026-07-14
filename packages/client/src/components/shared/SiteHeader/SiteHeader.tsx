import { cva } from 'class-variance-authority';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { appShell } from '~/config/app-shell';
import * as Icon from '~/icon';
import { panel } from '~/modules/panel';
import PanelContent from '../PanelContent';

const navGroupClass = cva(
    'flex min-w-max flex-col gap-[var(--b-spacing-xs)] lg:min-w-0 [&_ul]:m-0 [&_ul]:flex [&_ul]:list-none [&_ul]:items-center [&_ul]:gap-[var(--b-spacing-xs)] [&_ul]:p-0 lg:[&_ul]:w-full lg:[&_ul]:flex-col lg:[&_ul]:items-stretch',
    {
        variants: {
            position: {
                primary: '',
                utility: 'lg:mt-auto lg:border-t lg:border-[var(--b-color-border-subtle)] lg:pt-[var(--b-spacing-md)]'
            }
        },
        defaultVariants: {
            position: 'primary'
        }
    }
);

const navLinkClass = cva(
    [
        'relative flex min-h-11 items-center gap-[var(--b-spacing-sm)] rounded-full border border-transparent px-3.5 text-sm font-medium no-underline transition-[color,background-color,border-color] duration-150',
        'text-[var(--b-color-text-secondary)] hover:border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-surface-subtle)] hover:text-[var(--b-color-text)]',
        'lg:rounded-[var(--b-radius-lg)] lg:text-[var(--b-color-text-tertiary)] lg:before:absolute lg:before:left-0 lg:before:h-[18px] lg:before:w-[3px] lg:before:rounded-full lg:before:bg-transparent lg:before:content-[""]',
        '[&_svg]:h-[18.88px] [&_svg]:w-[18.88px] [&_svg]:shrink-0 [&_svg]:transition-colors [&_svg]:duration-150'
    ],
    {
        variants: {
            active: {
                true: 'border-[var(--b-color-border-subtle)] ow-active-background text-[var(--b-color-point)] [&_span]:text-[var(--b-color-point)] [&_svg]:text-[var(--b-color-point)] lg:before:bg-[var(--b-color-point)]',
                false: ''
            }
        },
        defaultVariants: {
            active: false
        }
    }
);

const mobileNavItemClass = cva(
    [
        'flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[var(--b-radius-lg)] px-1',
        'text-[11px] font-medium text-[var(--b-color-text-tertiary)] transition-[color,background-color] duration-150',
        'hover:bg-[var(--b-color-surface-subtle)] hover:text-[var(--b-color-text)]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
        '[&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0'
    ],
    {
        variants: {
            active: {
                true: 'bg-[var(--b-color-active)] text-[var(--b-color-point-light)]',
                false: ''
            }
        },
        defaultVariants: {
            active: false
        }
    }
);

const NAVIGATION_GROUPS = [
    {
        id: 'primary',
        items: appShell.navigation.primary
    },
    {
        id: 'utility',
        items: appShell.navigation.utility
    }
];

const MOBILE_PRIMARY_IDS = new Set(['home', 'library', 'favorites']);
const MOBILE_PRIMARY_ITEMS = appShell.navigation.primary.filter(item => MOBILE_PRIMARY_IDS.has(item.id));
const MOBILE_MORE_ITEMS = [
    ...appShell.navigation.primary.filter(item => !MOBILE_PRIMARY_IDS.has(item.id)),
    ...appShell.navigation.utility
];

export default function SiteHeader() {
    const location = useLocation();
    const navigate = useNavigate();

    const isActive = (path: string) => {
        if (path === '/') {
            return location.pathname === path;
        }

        return location.pathname.startsWith(path);
    };

    const isMoreActive = MOBILE_MORE_ITEMS.some(item => isActive(item.path)) || location.pathname === '/tag';

    const openMoreNavigation = () => {
        panel.open({
            title: 'Browse',
            content: (
                <PanelContent
                    items={MOBILE_MORE_ITEMS.map(item => ({
                        id: item.id,
                        icon: <item.icon />,
                        text: item.label,
                        active: isActive(item.path),
                        onClick: () => {
                            navigate(item.path);
                            panel.close();
                        }
                    }))}
                />
            )
        });
    };

    return (
        <header className="relative flex h-16 flex-col justify-center border-b border-[var(--b-color-border-subtle)] bg-[var(--b-color-background)] px-3 lg:h-full lg:justify-start lg:border-b-0 lg:border-r lg:py-[var(--b-spacing-lg)]">
            <nav
                className="relative z-[1] flex w-full items-center gap-1 lg:hidden"
                aria-label={`${appShell.brand.name} primary navigation`}>
                {MOBILE_PRIMARY_ITEMS.map((item) => {
                    const active = isActive(item.path);

                    return (
                        <Link
                            key={item.id}
                            to={item.path}
                            data-active={active ? 'true' : undefined}
                            aria-current={active ? 'page' : undefined}
                            className={mobileNavItemClass({ active })}>
                            <item.icon />
                            <span className="max-w-full truncate">{item.label}</span>
                        </Link>
                    );
                })}
                <button
                    type="button"
                    className={mobileNavItemClass({ active: isMoreActive })}
                    aria-haspopup="dialog"
                    aria-pressed={isMoreActive}
                    onClick={openMoreNavigation}>
                    <Icon.Menu />
                    <span>More</span>
                </button>
            </nav>
            <nav
                className="relative z-[1] hidden flex-1 flex-col gap-[var(--b-spacing-md)] lg:flex"
                aria-label={`${appShell.brand.name} navigation`}>
                {NAVIGATION_GROUPS.map((group) => (
                    <div
                        key={group.id}
                        className={navGroupClass({ position: group.id === 'utility' ? 'utility' : 'primary' })}>
                        <ul>
                            {group.items.map((item) => {
                                const active = isActive(item.path);

                                return (
                                    <li key={item.id}>
                                        <Link
                                            to={item.path}
                                            data-active={active ? 'true' : undefined}
                                            aria-current={active ? 'page' : undefined}
                                            className={navLinkClass({ active })}>
                                            <item.icon />
                                            <span className="whitespace-nowrap">{item.label}</span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </nav>
        </header>
    );
}
