import { expect, test, type Page } from '@playwright/test';

const GENERATED_AT = '2026-07-21T00:00:00.000Z';
const DORMANT_IDS = Array.from({ length: 5 }, (_, index) => `dormant-${index + 1}`);
const FORGOTTEN_IDS = Array.from({ length: 5 }, (_, index) => `forgotten-${index + 1}`);
const LIBRARY_IDS = Array.from({ length: 20 }, (_, index) => `library-${index + 1}`);

const createMusic = (id: string, index: number) => {
    const label = id.startsWith('dormant')
        ? 'Favorite'
        : id.startsWith('forgotten') ? 'Forgotten' : 'Library';

    return {
        album: {
            cover: '',
            id: `album-${id}`,
            isCoverCustom: false,
            name: `${label} Album ${index + 1}`,
            publishedYear: '2024'
        },
        artist: {
            id: `artist-${id}`,
            name: `${label} Artist ${index + 1}`
        },
        codec: 'FLAC',
        completionCount: 2,
        createdAt: Date.parse('2024-01-01T00:00:00.000Z'),
        duration: 180,
        filePath: `/${id}.flac`,
        hasMetadataOverride: false,
        id,
        isHated: false,
        isLiked: id.startsWith('dormant'),
        lastCompletedAt: '2025-01-01T00:00:00.000Z',
        lastPlayedAt: '2025-01-01T00:00:00.000Z',
        lastSkippedAt: null,
        name: `${label} Track ${index + 1}`,
        playCount: 2,
        sampleRate: 44_100,
        skipCount: 0,
        tags: [],
        totalPlayedMs: 360_000,
        trackNumber: 1
    };
};

const musics = [
    ...DORMANT_IDS.map(createMusic),
    ...FORGOTTEN_IDS.map(createMusic),
    ...LIBRARY_IDS.map(createMusic)
];

const mockLibraryRediscovery = async (page: Page) => {
    const state: {
        delayMs: number;
        mode: 'error' | 'full' | 'recent-only';
        requestCount: number;
        responseCount: number;
    } = {
        delayMs: 0,
        mode: 'full',
        requestCount: 0,
        responseCount: 0
    };

    await page.route('**/graphql', async (route) => {
        const operationName = route.request().postDataJSON()?.operationName;

        if (operationName === 'AllMusics') {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({ data: { allMusics: musics } })
            });
            return;
        }

        if (operationName === 'LibraryRediscovery') {
            const delayMs = state.delayMs;
            const mode = state.mode;
            state.requestCount += 1;

            if (delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }

            if (mode === 'error') {
                await route.fulfill({
                    contentType: 'application/json',
                    status: 500,
                    body: JSON.stringify({ message: 'Rediscovery unavailable' })
                });
                state.responseCount += 1;
                return;
            }

            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        libraryRediscovery: {
                            dormantLiked: mode === 'full'
                                ? DORMANT_IDS.map(musicId => ({
                                musicId,
                                reasonCodes: ['LIKED_NOT_RECENTLY_PLAYED'],
                                score: 90
                            }))
                                : [],
                            eligibleMusicCount: musics.length,
                            fallback: [],
                            forgottenAlbums: mode === 'full'
                                ? FORGOTTEN_IDS.map((representativeMusicId) => ({
                                albumId: `album-${representativeMusicId}`,
                                lastPlayedAt: '2025-01-01T00:00:00.000Z',
                                reasonCodes: ['FORGOTTEN_ALBUM'],
                                representativeMusicId,
                                score: 80,
                                trackCount: 8
                            }))
                                : [],
                            generatedAt: GENERATED_AT,
                            recentlyAdded: mode === 'recent-only'
                                ? DORMANT_IDS.map(musicId => ({
                                    musicId,
                                    reasonCodes: ['RECENTLY_ADDED'],
                                    score: 85
                                }))
                                : [],
                            underplayed: []
                        }
                    }
                })
            });
            state.responseCount += 1;
            return;
        }

        await route.continue();
    });

    return state;
};

const getSectionItems = (page: Page, name: string) => page
    .getByRole('region', { name })
    .getByRole('listitem');

test.describe('Library rediscovery responsive presentation', () => {
    test('keeps five compact cards on one desktop row', async ({ page }) => {
        await page.setViewportSize({ width: 1_280, height: 900 });
        await mockLibraryRediscovery(page);
        await page.goto('/library');

        const favoriteSection = page.getByRole('region', {
            name: 'Favorites worth revisiting'
        });
        await expect(favoriteSection).toBeVisible();
        await expect(favoriteSection.getByText('Liked, but not played in a while')).toHaveCount(5);

        const items = getSectionItems(page, 'Favorites worth revisiting');
        await expect(items).toHaveCount(5);
        const rows = await items.evaluateAll(cards => new Set(cards.map(card => (
            Math.round(card.getBoundingClientRect().top)
        ))).size);

        expect(rows).toBe(1);
        await expect(page.getByRole('region', {
            name: 'Albums you may have forgotten'
        })).toBeVisible();
    });

    test('uses two mobile columns without horizontal overflow', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await mockLibraryRediscovery(page);
        await page.goto('/library');

        const items = getSectionItems(page, 'Favorites worth revisiting');
        await expect(items).toHaveCount(5);
        const rows = await items.evaluateAll(cards => new Set(cards.map(card => (
            Math.round(card.getBoundingClientRect().top)
        ))).size);
        const scrollMetrics = await page.locator('.main-container').evaluate(element => ({
            clientHeight: element.clientHeight,
            clientWidth: element.clientWidth,
            scrollHeight: element.scrollHeight,
            scrollWidth: element.scrollWidth
        }));

        expect(rows).toBe(3);
        expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(scrollMetrics.clientWidth + 1);
        expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);

        const albumSection = page.getByRole('region', {
            name: 'Albums you may have forgotten'
        });
        await albumSection.scrollIntoViewIfNeeded();
        await expect(albumSection).toBeVisible();
        await expect(albumSection.getByText('Not played in a while')).toHaveCount(5);
    });

    test('keeps the song list usable while optional rediscovery is delayed or fails', async ({ page }) => {
        await page.setViewportSize({ width: 1_280, height: 900 });
        const rediscovery = await mockLibraryRediscovery(page);
        rediscovery.delayMs = 3_000;
        await page.goto('/library');

        await page.locator('.main-container').evaluate((element) => {
            element.scrollTop = 800;
            element.dispatchEvent(new Event('scroll'));
        });
        const visibleTrack = page.getByRole('button', {
            name: /^Library Album 5 Library Track 5/
        });
        await expect(visibleTrack).toBeVisible();
        const beforeTop = await visibleTrack.evaluate(element => (
            element.getBoundingClientRect().top
        ));

        await expect.poll(() => rediscovery.responseCount).toBe(1);
        const afterTop = await visibleTrack.evaluate(element => (
            element.getBoundingClientRect().top
        ));

        expect(Math.abs(afterTop - beforeTop)).toBeLessThanOrEqual(1);
        await expect(page.getByRole('region', {
            name: 'Favorites worth revisiting'
        })).toHaveCount(0);

        rediscovery.delayMs = 0;
        rediscovery.mode = 'error';
        await page.getByRole('link', { exact: true, name: 'Now' }).click();
        await page.getByRole('link', { exact: true, name: 'Library' }).click();

        await expect.poll(() => rediscovery.requestCount).toBe(2);
        await expect(page.getByRole('button', {
            name: /Favorite Album 1 Favorite Track 1/
        })).toBeVisible();
        await expect(page.locator('[aria-label="Library rediscovery"]')).toHaveCount(0);
    });

    test('freezes cards during one visit and refreshes after returning to Library', async ({ page }) => {
        await page.setViewportSize({ width: 1_280, height: 900 });
        const rediscovery = await mockLibraryRediscovery(page);
        await page.goto('/library');

        await expect(page.getByRole('region', {
            name: 'Favorites worth revisiting'
        })).toBeVisible();
        expect(rediscovery.requestCount).toBe(1);

        rediscovery.mode = 'recent-only';
        const search = page.getByRole('textbox', { name: 'Search music' });
        await search.fill('Favorite');
        await expect(page.getByRole('region', {
            name: 'Favorites worth revisiting'
        })).toHaveCount(0);
        await search.clear();
        await expect(page.getByRole('region', {
            name: 'Favorites worth revisiting'
        })).toBeVisible();
        expect(rediscovery.requestCount).toBe(1);

        await page.getByRole('link', { exact: true, name: 'Now' }).click();
        await page.getByRole('link', { exact: true, name: 'Library' }).click();

        await expect(page.getByRole('region', { name: 'Recently added' })).toBeVisible();
        await expect(page.getByRole('region', {
            name: 'Favorites worth revisiting'
        })).toHaveCount(0);
        expect(rediscovery.requestCount).toBe(2);
    });
});
