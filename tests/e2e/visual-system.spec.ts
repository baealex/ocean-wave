import { expect, test, type Locator, type Page } from '@playwright/test';

const waitForVisualReady = async (page: Page) => {
    await page.locator('main').waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
};

const readSurfaceStyle = (locator: Locator) => locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();

    return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderWidth: style.borderWidth,
        height: bounds.height,
        transform: style.transform,
        width: bounds.width
    };
});

test.describe('visual system regression', () => {
    test('keeps the desktop collection rhythm stable', async ({ page }) => {
        await page.setViewportSize({ width: 1_280, height: 900 });
        await page.goto('/album');
        await expect(page.getByRole('heading', { name: 'Albums' })).toBeVisible();
        await expect(page.locator('a[href^="/album/"]').first()).toBeVisible();
        await waitForVisualReady(page);

        await expect(page).toHaveScreenshot('desktop-album-collection.png', {
            animations: 'disabled',
            maxDiffPixelRatio: 0.01
        });
    });

    test('keeps the mobile collection and bottom navigation stable', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/album');
        await expect(page.getByRole('heading', { name: 'Albums' })).toBeVisible();
        await expect(page.locator('a[href^="/album/"]').first()).toBeVisible();
        await waitForVisualReady(page);

        await expect(page).toHaveScreenshot('mobile-album-collection.png', {
            animations: 'disabled',
            clip: { x: 0, y: 0, width: 390, height: 640 },
            maxDiffPixelRatio: 0.01
        });
        const bottomNavigation = page.getByRole('navigation', {
            name: 'Ocean Wave primary navigation'
        }).locator('..');
        await expect(bottomNavigation).toHaveScreenshot(
            'mobile-bottom-navigation.png',
            {
                animations: 'disabled',
                maxDiffPixelRatio: 0.01
            }
        );
    });

    test('does not turn navigation or collection links into hover boxes', async ({ page }) => {
        await page.setViewportSize({ width: 1_280, height: 900 });
        await page.goto('/album');

        const card = page.locator('a[href^="/album/"]').first();
        const artwork = card.locator(':scope > span').first();
        const nowLink = page.getByRole('link', { exact: true, name: 'Now' });
        await expect(card).toBeVisible();

        const cardBefore = await readSurfaceStyle(card);
        const artworkBefore = await readSurfaceStyle(artwork);
        await card.hover();
        const cardAfter = await readSurfaceStyle(card);
        const artworkAfter = await readSurfaceStyle(artwork);

        expect(cardAfter).toEqual(cardBefore);
        expect(artworkAfter).toEqual(artworkBefore);

        const navigationBefore = await readSurfaceStyle(nowLink);
        await nowLink.hover();
        const navigationAfter = await readSurfaceStyle(nowLink);

        expect(navigationAfter.backgroundColor).toBe(navigationBefore.backgroundColor);
        expect(navigationAfter.borderWidth).toBe(navigationBefore.borderWidth);
        expect(navigationAfter.height).toBe(navigationBefore.height);
        expect(navigationAfter.width).toBe(navigationBefore.width);
    });
});
