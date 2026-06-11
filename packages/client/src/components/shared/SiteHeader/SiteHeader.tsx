import { cva } from 'class-variance-authority';
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { appShell } from '~/config/app-shell';

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

export default function SiteHeader() {
    const location = useLocation();

    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;

        if (el) {
            const activeItem = el.querySelector<HTMLAnchorElement>('a[data-active="true"]');

            if (activeItem) {
                const { left, width } = activeItem.getBoundingClientRect();
                const { left: navLeft, width: navWidth } = el.getBoundingClientRect();
                const center = left - navLeft + width / 2 - navWidth / 2;
                el.scrollBy({
                    left: center,
                    behavior: 'smooth'
                });
            }
        }
    }, [location.pathname]);

    const isActive = (path: string) => {
        if (path === '/') {
            return location.pathname === path;
        }

        return location.pathname.startsWith(path);
    };

    return (
        <header className="relative flex h-16 flex-col justify-center gap-[var(--b-spacing-sm)] border-b border-[var(--b-color-border-subtle)] bg-[var(--b-color-background)] px-3 lg:h-full lg:justify-start lg:gap-[var(--b-spacing-lg)] lg:border-b-0 lg:border-r lg:px-3 lg:py-[var(--b-spacing-lg)]">
            <nav
                ref={ref}
                className="relative z-[1] flex gap-[var(--b-spacing-sm)] overflow-x-auto overflow-y-hidden px-1 [mask-image:linear-gradient(90deg,transparent,var(--b-color-static-white)_28px,var(--b-color-static-white)_calc(100%-28px),transparent)] [scrollbar-width:none] lg:flex-1 lg:flex-col lg:gap-[var(--b-spacing-md)] lg:overflow-visible lg:px-0 lg:[mask-image:none] [&::-webkit-scrollbar]:hidden"
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
