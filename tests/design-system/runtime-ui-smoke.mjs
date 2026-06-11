import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const APP_ORIGIN = process.env.OCEAN_WAVE_RUNTIME_ORIGIN ?? 'http://localhost:5175';
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const QUEUE_SIZE = 3;
const DESKTOP_VIEWPORT = {
    width: 1280,
    height: 860
};
const MOBILE_VIEWPORT = {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runtimeScript = (queueItems) => `
(() => {
    try {
        localStorage.setItem('queue', ${JSON.stringify(JSON.stringify({
    items: queueItems,
    selected: 0,
    shuffle: true,
    insertMode: 'last',
    repeatMode: 'none',
    playMode: 'later',
    mixMode: 'none',
    sourceItems: queueItems
}))});
    } catch {
        // Ignore origins that do not allow localStorage during early browser setup.
    }
})();
`;

class CdpClient {
    #id = 0;
    #pending = new Map();
    #handlers = new Map();

    constructor(webSocketUrl) {
        this.socket = new WebSocket(webSocketUrl);
        this.ready = new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);

            if (message.id) {
                const pending = this.#pending.get(message.id);

                if (!pending) {
                    return;
                }

                this.#pending.delete(message.id);

                if (message.error) {
                    pending.reject(new Error(message.error.message));
                    return;
                }

                pending.resolve(message.result);
                return;
            }

            const handlers = this.#handlers.get(message.method) ?? [];

            for (const handler of handlers) {
                handler(message.params);
            }
        });
    }

    on(method, handler) {
        this.#handlers.set(method, [
            ...(this.#handlers.get(method) ?? []),
            handler
        ]);
    }

    async send(method, params = {}) {
        await this.ready;
        const id = this.#id += 1;

        return new Promise((resolve, reject) => {
            this.#pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    close() {
        this.socket.close();
    }
}

const findChrome = async () => {
    try {
        await readFile(CHROME_PATH);
        return CHROME_PATH;
    } catch {
        throw new Error(`Chrome executable was not found at ${CHROME_PATH}. Set CHROME_PATH to run runtime UI smoke tests.`);
    }
};

const waitForDevTools = async (userDataDir, chromeProcess) => {
    const activePortPath = path.join(userDataDir, 'DevToolsActivePort');
    const startedAt = Date.now();

    while (Date.now() - startedAt < 10_000) {
        if (chromeProcess.exitCode !== null) {
            throw new Error(`Chrome exited before DevTools became available with code ${chromeProcess.exitCode}`);
        }

        try {
            const [port] = (await readFile(activePortPath, 'utf8')).trim().split('\n');
            return Number(port);
        } catch {
            await sleep(100);
        }
    }

    throw new Error('Timed out waiting for Chrome DevToolsActivePort.');
};

const createTarget = async (port) => {
    const baseUrl = `http://127.0.0.1:${port}`;
    const response = await fetch(`${baseUrl}/json/new?${encodeURIComponent('about:blank')}`, {
        method: 'PUT'
    });

    if (response.ok) {
        return response.json();
    }

    const targets = await (await fetch(`${baseUrl}/json/list`)).json();
    const target = targets.find((item) => item.type === 'page');

    if (!target) {
        throw new Error('Chrome did not expose a debuggable page target.');
    }

    return target;
};

const createBrowser = async () => {
    const chrome = await findChrome();
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ocean-wave-runtime-ui-'));
    const screenshotDir = await mkdtemp(path.join(os.tmpdir(), 'ocean-wave-screenshots-'));
    const chromeProcess = spawn(chrome, [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        'about:blank'
    ], {
        stdio: ['ignore', 'ignore', 'pipe']
    });

    const stderr = [];
    chromeProcess.stderr.on('data', (chunk) => {
        stderr.push(chunk.toString());
    });

    const port = await waitForDevTools(userDataDir, chromeProcess);
    const target = await createTarget(port);
    const client = new CdpClient(target.webSocketDebuggerUrl);
    const runtimeErrors = [];

    client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
        runtimeErrors.push(exceptionDetails.text ?? exceptionDetails.exception?.description ?? 'Runtime exception');
    });
    client.on('Runtime.consoleAPICalled', ({ type, args }) => {
        if (type === 'error') {
            runtimeErrors.push(args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
        }
    });

    await client.send('Runtime.enable');
    await client.send('Page.enable');

    return {
        client,
        screenshotDir,
        async close() {
            client.close();
            if (chromeProcess.exitCode === null) {
                chromeProcess.kill('SIGTERM');
                await Promise.race([
                    once(chromeProcess, 'exit'),
                    sleep(2_000)
                ]);
            }
            await rm(userDataDir, {
                force: true,
                maxRetries: 5,
                recursive: true,
                retryDelay: 100
            });
        },
        runtimeErrors,
        stderr
    };
};

const evaluate = async (client, expression) => {
    const result = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
    });

    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }

    return result.result.value;
};

const waitFor = async (client, description, expression, timeoutMs = 15_000) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (await evaluate(client, expression)) {
            return;
        }

        await sleep(250);
    }

    const diagnostics = await evaluate(client, `(() => ({
        url: window.location.href,
        text: document.body.innerText.slice(0, 800)
    }))()`).catch(() => null);

    throw new Error([
        `Timed out waiting for ${description}.`,
        diagnostics ? `URL: ${diagnostics.url}` : '',
        diagnostics?.text ? `Text: ${diagnostics.text}` : ''
    ].filter(Boolean).join('\n'));
};

const pressKey = async (client, key, code = key) => {
    await client.send('Input.dispatchKeyEvent', {
        code,
        key,
        type: 'keyDown'
    });
    await client.send('Input.dispatchKeyEvent', {
        code,
        key,
        type: 'keyUp'
    });
};

const clickViewport = async (client, x, y) => {
    await client.send('Input.dispatchMouseEvent', {
        button: 'left',
        clickCount: 1,
        type: 'mousePressed',
        x,
        y
    });
    await client.send('Input.dispatchMouseEvent', {
        button: 'left',
        clickCount: 1,
        type: 'mouseReleased',
        x,
        y
    });
};

const navigate = async (browser, pathName, viewport) => {
    const { client } = browser;

    await client.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
        mobile: viewport.mobile ?? false
    });
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: runtimeScript(browser.queueItems)
    });
    await client.send('Page.navigate', {
        url: `${APP_ORIGIN}${pathName}`
    });
    await waitFor(client, 'app root', `Boolean(document.querySelector('#root main'))`);
};

const captureScreenshot = async (browser, name) => {
    const screenshot = await browser.client.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true
    });
    const filePath = path.join(browser.screenshotDir, `${name}.png`);

    await mkdir(browser.screenshotDir, { recursive: true });
    await writeFile(filePath, Buffer.from(screenshot.data, 'base64'));

    return filePath;
};

const getRuntimeSeed = async () => {
    const response = await fetch(`${APP_ORIGIN}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            query: `{
                allMusics {
                    id
                    name
                    isLiked
                    album { id name }
                    artist { id name }
                }
                allAlbums { id name }
                allArtists { id name }
                allPlaylist { id name }
                allTags(pagination: { limit: 20, offset: 0 }) {
                    totalCount
                    tags { id name }
                }
            }`
        })
    });

    assert.equal(response.status, 200, `Expected ${APP_ORIGIN}/graphql to be reachable.`);
    const payload = await response.json();

    assert.equal(payload.errors, undefined, JSON.stringify(payload.errors));

    const musics = payload.data.allMusics;
    const likedMusic = musics.find((music) => music.isLiked) ?? musics[0];

    assert.ok(likedMusic, 'Runtime UI smoke test needs at least one music item.');
    assert.ok(payload.data.allTags.totalCount > 0, 'Runtime UI smoke test needs at least one tag.');

    return {
        likedMusic,
        routeSeeds: {
            album: payload.data.allAlbums[0],
            artist: payload.data.allArtists[0],
            playlist: payload.data.allPlaylist[0]
        },
        queueItems: [
            likedMusic.id,
            ...musics
                .filter((music) => music.id !== likedMusic.id)
                .slice(0, QUEUE_SIZE - 1)
                .map((music) => music.id)
        ]
    };
};

const getRouteSmokeCases = (seed) => [
    {
        path: '/',
        label: 'home',
        text: 'Now'
    },
    {
        path: '/dashboard',
        label: 'dashboard',
        text: 'Dashboard'
    },
    {
        path: '/library',
        label: 'library',
        text: 'Library'
    },
    {
        path: '/favorite',
        label: 'favorites',
        text: 'Favorites'
    },
    {
        path: '/album',
        label: 'albums',
        text: 'Albums'
    },
    {
        path: '/artist',
        label: 'artists',
        text: 'Artists'
    },
    {
        path: '/playlist',
        label: 'playlists',
        text: 'Playlists'
    },
    {
        path: '/setting',
        label: 'settings',
        text: 'Settings'
    },
    {
        path: '/equalizer',
        label: 'equalizer',
        text: '7-BAND EQ'
    },
    seed.routeSeeds.album && {
        path: `/album/${seed.routeSeeds.album.id}`,
        label: 'album-detail',
        text: seed.routeSeeds.album.name
    },
    seed.routeSeeds.artist && {
        path: `/artist/${seed.routeSeeds.artist.id}`,
        label: 'artist-detail',
        text: seed.routeSeeds.artist.name
    },
    seed.routeSeeds.playlist && {
        path: `/playlist/${seed.routeSeeds.playlist.id}`,
        label: 'playlist-detail',
        text: seed.routeSeeds.playlist.name
    }
].filter(Boolean);

const pageStyleAssertions = {
    routeSurface: `(() => {
        const fail = (message) => { throw new Error(message); };
        const viewportWidth = window.innerWidth;
        const pageWidth = Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth
        );

        if (pageWidth > viewportWidth + 2) {
            fail('Route introduced document-level horizontal overflow: ' + pageWidth + ' > ' + viewportWidth);
        }

        const visibleInteractive = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')]
            .filter((element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);

                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    !element.closest('[aria-hidden="true"]');
            });
        const smallTargets = visibleInteractive
            .filter((element) => {
                const rect = element.getBoundingClientRect();

                return rect.width < 32 || rect.height < 32;
            })
            .slice(0, 5)
            .map((element) => {
                const rect = element.getBoundingClientRect();
                const label = element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName;

                return label + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height);
            });

        if (smallTargets.length > 0) {
            fail('Route rendered undersized interactive targets: ' + smallTargets.join(', '));
        }

        if (document.body.innerText.trim().length === 0) {
            fail('Route rendered an empty visible surface.');
        }

        return {
            pageWidth,
            targetCount: visibleInteractive.length
        };
    })()`,
    player: `(() => {
        const fail = (message) => { throw new Error(message); };
        const normalize = (value) => String(value).replace(/\\s+/g, '').toLowerCase();
        const resolveColor = (property, value) => {
            const node = document.createElement('span');
            node.style[property] = value;
            document.body.append(node);
            const resolved = getComputedStyle(node)[property];
            node.remove();
            return resolved;
        };
        const sameColor = (a, b) => normalize(a) === normalize(b);
        const point = resolveColor('color', 'var(--b-color-point)');
        const active = resolveColor('backgroundColor', 'var(--b-color-active)');
        const transparent = 'rgba(0, 0, 0, 0)';
        const buttons = [...document.querySelectorAll('button')];
        const playButtons = buttons
            .filter((button) => /^(Resume|Pause) playback$/.test(button.getAttribute('aria-label') ?? ''))
            .sort((a, b) => {
                const aRect = a.getBoundingClientRect();
                const bRect = b.getBoundingClientRect();
                return (bRect.width * bRect.height) - (aRect.width * aRect.height);
            });
        const playButton = playButtons[0];

        if (!playButton) fail('Player play button was not rendered.');
        if (!sameColor(getComputedStyle(playButton).backgroundColor, point)) {
            fail('Player play button is not using the primary point background.');
        }

        const shuffleButton = document.querySelector('button[aria-label="Disable shuffle"]');

        if (!shuffleButton) fail('Active shuffle button was not rendered.');
        if (!sameColor(getComputedStyle(shuffleButton).backgroundColor, transparent)) {
            fail('Active shuffle button should remain icon-only without an active background.');
        }

        const shuffleSvg = shuffleButton.querySelector('svg');

        if (!shuffleSvg || !sameColor(getComputedStyle(shuffleSvg).color, point)) {
            fail('Active shuffle icon is not using the point color.');
        }

        const likedButton = buttons.find((button) => button.textContent?.includes('Liked'));

        if (!likedButton) fail('Player detail liked action was not rendered.');

        const heartPath = likedButton.querySelector('svg path');

        if (!heartPath) fail('Liked action heart icon path was not rendered.');

        const heartStyle = getComputedStyle(heartPath);

        if (!sameColor(heartStyle.fill, point) || !sameColor(heartStyle.stroke, point)) {
            fail('Liked action heart fill and stroke should both use the point color.');
        }

        return {
            playButtonBackground: getComputedStyle(playButton).backgroundColor,
            shuffleIconColor: getComputedStyle(shuffleSvg).color,
            heartFill: heartStyle.fill,
            activeBackground: active
        };
    })()`,
    playerOpenAudioMenu: `(() => {
        const fail = (message) => { throw new Error(message); };
        const trigger = document.querySelector('button[aria-label="Open audio menu"]');

        if (!trigger) fail('Player audio menu trigger was not rendered.');

        trigger.focus();
        trigger.click();

        return true;
    })()`,
    playerAudioMenu: `(() => {
        const fail = (message) => { throw new Error(message); };
        const dialog = document.querySelector('[role="dialog"]');
        const trigger = document.querySelector('button[aria-label="Open audio menu"]');
        const closeButton = document.querySelector('button[aria-label="Close audio menu"]');

        if (!dialog) fail('Audio menu dialog was not rendered.');
        if (trigger?.getAttribute('aria-expanded') !== 'true') {
            fail('Audio menu trigger did not expose expanded state.');
        }
        if (!dialog.contains(document.activeElement)) {
            fail('Audio menu did not move focus inside the dialog.');
        }
        if (!dialog.textContent?.includes('Audio')) fail('Audio menu title was not rendered.');
        if (!dialog.textContent?.includes('Visualizer and playback tools')) {
            fail('Audio menu description was not rendered.');
        }
        if (!dialog.textContent?.includes('Player Effect') || !dialog.textContent?.includes('Transition')) {
            fail('Audio menu sections were not rendered.');
        }
        if (!closeButton) fail('Audio menu close button was not rendered.');

        return {
            activeElementLabel: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim(),
            dialogText: dialog.textContent?.slice(0, 120)
        };
    })()`,
    playerAudioMenuCloseButton: `(() => {
        const fail = (message) => { throw new Error(message); };
        const closeButton = document.querySelector('button[aria-label="Close audio menu"]');

        if (!closeButton) fail('Audio menu close button was not rendered.');

        closeButton.click();

        return true;
    })()`,
    playerAudioMenuClosed: `(() => {
        const fail = (message) => { throw new Error(message); };
        const trigger = document.querySelector('button[aria-label="Open audio menu"]');

        if (document.querySelector('[role="dialog"]')) fail('Audio menu dialog was not dismissed.');
        if (!trigger) fail('Player audio menu trigger was not rendered after dismiss.');
        if (trigger.getAttribute('aria-expanded') !== 'false') {
            fail('Audio menu trigger did not expose collapsed state.');
        }
        if (document.activeElement !== trigger) {
            fail('Audio menu dismiss did not restore focus to the trigger.');
        }

        return true;
    })()`,
    playerOpenMoreActions: `(() => {
        const fail = (message) => { throw new Error(message); };
        const moreButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'More');

        if (!moreButton) fail('Player More action was not rendered.');

        moreButton.click();

        return true;
    })()`,
    playerDialog: `(() => {
        const fail = (message) => { throw new Error(message); };
        const dialog = document.querySelector('[role="dialog"]');

        if (!dialog) fail('More actions dialog was not rendered.');
        if (dialog.textContent?.includes('Album') || dialog.textContent?.includes('Artist')) {
            fail('Player detail More actions should not reintroduce album or artist buttons.');
        }

        return true;
    })()`,
    tagsEnterSelectMode: `(() => {
        const fail = (message) => { throw new Error(message); };
        const selectToolbarButton = document.querySelector('button[aria-label="Select"]');

        if (!selectToolbarButton) fail('Tag select toolbar button was not rendered.');

        selectToolbarButton.click();

        return true;
    })()`,
    tagsSelectFirst: `(() => {
        const fail = (message) => { throw new Error(message); };
        const tagButton = document.querySelector('button[aria-label^="Select "]');

        if (!tagButton) fail('Selectable tag row was not rendered.');

        tagButton.click();

        return true;
    })()`,
    tags: `(() => {
        const fail = (message) => { throw new Error(message); };
        const normalize = (value) => String(value).replace(/\\s+/g, '').toLowerCase();
        const resolveColor = (property, value) => {
            const node = document.createElement('span');
            node.style[property] = value;
            document.body.append(node);
            const resolved = getComputedStyle(node)[property];
            node.remove();
            return resolved;
        };
        const sameColor = (a, b) => normalize(a) === normalize(b);
        const point = resolveColor('color', 'var(--b-color-point)');
        const activeBackground = resolveColor('backgroundColor', 'var(--b-color-active)');
        const selectedRow = document.querySelector('button[aria-label^="Unselect "][aria-pressed="true"]');

        if (!selectedRow) fail('Selected tag row did not expose aria-pressed feedback.');

        const indicator = selectedRow.querySelector('[aria-hidden="true"]');
        const indicatorSvg = indicator?.querySelector('svg');
        let activeSurfaceRuleText = '';
        const hasActiveSurfaceRule = [...document.styleSheets].some((styleSheet) => {
            try {
                return [...styleSheet.cssRules].some((rule) => {
                    if (rule.cssText.includes('ow-active-surface')) {
                        activeSurfaceRuleText = rule.cssText;
                        return true;
                    }

                    return false;
                });
            } catch {
                return false;
            }
        });

        if (!indicator || !indicatorSvg) fail('Selected tag row indicator was not rendered.');
        if (!sameColor(getComputedStyle(indicator).backgroundColor, activeBackground)) {
            const matchedBackgroundRules = [...document.styleSheets].flatMap((styleSheet) => {
                try {
                    return [...styleSheet.cssRules].flatMap((rule) => {
                        if (!rule.selectorText || !rule.style || !rule.cssText.includes('background')) {
                            return [];
                        }

                        try {
                            return indicator.matches(rule.selectorText)
                                ? [rule.cssText]
                                : [];
                        } catch {
                            return [];
                        }
                    });
                } catch {
                    return [];
                }
            }).slice(-8).join(' || ');
            fail([
                'Selected tag indicator does not use the active background.',
                'actual=' + getComputedStyle(indicator).backgroundColor,
                'var=' + getComputedStyle(indicator).getPropertyValue('--b-color-active').trim(),
                'shadow=' + getComputedStyle(indicator).boxShadow,
                'expected=' + activeBackground,
                'hasRule=' + hasActiveSurfaceRule,
                'rule=' + activeSurfaceRuleText,
                'matched=' + matchedBackgroundRules,
                'html=' + indicator.outerHTML
            ].join(' '));
        }
        if (!sameColor(getComputedStyle(indicatorSvg).color, point)) {
            fail('Selected tag indicator icon does not use the point color.');
        }
        if (!document.querySelector('[aria-label="Selected tag actions"]')) {
            fail('Selected tag action bar was not rendered.');
        }

        return {
            indicatorBackground: getComputedStyle(indicator).backgroundColor,
            indicatorIconColor: getComputedStyle(indicatorSvg).color
        };
    })()`,
    queueMoveFirstDown: `(() => {
        const fail = (message) => { throw new Error(message); };
        const rows = [...document.querySelectorAll('li[data-queue-index]')];

        if (rows.length < 2) fail('Queue needs at least two rendered rows for runtime smoke validation.');

        const handles = [...document.querySelectorAll('button[aria-label^="Move "][aria-label$=" in queue"]')];

        if (handles.length === 0) fail('Queue reorder handle was not rendered with keyboard-accessible labeling.');

        const before = rows.map((row) => row.textContent).join('|');
        handles[0].dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true
        }));

        window.__runtimeQueueBefore = before;

        return {
            before,
            firstHandleLabel: handles[0].getAttribute('aria-label')
        };
    })()`,
    queue: `(() => {
        const fail = (message) => { throw new Error(message); };
        const nextRows = [...document.querySelectorAll('li[data-queue-index]')];
        const before = window.__runtimeQueueBefore;
        const after = nextRows.map((row) => row.textContent).join('|');

        if (before === after) {
            fail('Queue keyboard reorder did not change the rendered row order.');
        }

        const rects = nextRows.slice(0, 3).map((row) => row.getBoundingClientRect());

        for (let index = 1; index < rects.length; index += 1) {
            if (rects[index].top < rects[index - 1].top) {
                fail('Queue rows are not visually ordered top-to-bottom after keyboard reorder.');
            }
        }

        return {
            rowCount: nextRows.length
        };
    })()`
};

test('runtime UI smoke validates core active states in Chrome', async () => {
    const seed = await getRuntimeSeed();
    const browser = await createBrowser();

    browser.queueItems = seed.queueItems;

    try {
        for (const route of getRouteSmokeCases(seed)) {
            await navigate(browser, route.path, DESKTOP_VIEWPORT);
            await waitFor(browser.client, `${route.label} desktop content`, `document.body.innerText.includes(${JSON.stringify(route.text)})`);
            await evaluate(browser.client, pageStyleAssertions.routeSurface);
            await captureScreenshot(browser, `${route.label}-desktop`);

            await navigate(browser, route.path, MOBILE_VIEWPORT);
            await waitFor(browser.client, `${route.label} mobile content`, `document.body.innerText.includes(${JSON.stringify(route.text)})`);
            await evaluate(browser.client, pageStyleAssertions.routeSurface);
        }

        await navigate(browser, '/player', DESKTOP_VIEWPORT);
        await waitFor(browser.client, 'player detail', `document.body.innerText.toLowerCase().includes('now playing') && document.body.innerText.includes(${JSON.stringify(seed.likedMusic.name)})`);
        await evaluate(browser.client, pageStyleAssertions.player);

        await evaluate(browser.client, pageStyleAssertions.playerOpenAudioMenu);
        await waitFor(browser.client, 'player Audio dialog', `Boolean(document.querySelector('[role="dialog"]')) && document.querySelector('[role="dialog"]')?.textContent.includes('Audio')`);
        await evaluate(browser.client, pageStyleAssertions.playerAudioMenu);
        await pressKey(browser.client, 'Escape');
        await waitFor(browser.client, 'player Audio dialog dismissed by Escape', `!document.querySelector('[role="dialog"]') && document.activeElement === document.querySelector('button[aria-label="Open audio menu"]')`);
        await evaluate(browser.client, pageStyleAssertions.playerAudioMenuClosed);

        await evaluate(browser.client, pageStyleAssertions.playerOpenAudioMenu);
        await waitFor(browser.client, 'player Audio dialog reopened for close button', `Boolean(document.querySelector('[role="dialog"]')) && document.querySelector('[role="dialog"]')?.textContent.includes('Audio')`);
        await evaluate(browser.client, pageStyleAssertions.playerAudioMenuCloseButton);
        await waitFor(browser.client, 'player Audio dialog dismissed by close button', `!document.querySelector('[role="dialog"]') && document.activeElement === document.querySelector('button[aria-label="Open audio menu"]')`);
        await evaluate(browser.client, pageStyleAssertions.playerAudioMenuClosed);

        await evaluate(browser.client, pageStyleAssertions.playerOpenAudioMenu);
        await waitFor(browser.client, 'player Audio dialog reopened for overlay dismiss', `Boolean(document.querySelector('[role="dialog"]')) && document.querySelector('[role="dialog"]')?.textContent.includes('Audio')`);
        await clickViewport(browser.client, 10, 10);
        await waitFor(browser.client, 'player Audio dialog dismissed by overlay', `!document.querySelector('[role="dialog"]') && document.activeElement === document.querySelector('button[aria-label="Open audio menu"]')`);
        await evaluate(browser.client, pageStyleAssertions.playerAudioMenuClosed);

        await evaluate(browser.client, pageStyleAssertions.playerOpenMoreActions);
        await waitFor(browser.client, 'player More actions dialog', `Boolean(document.querySelector('[role="dialog"]'))`);
        await evaluate(browser.client, pageStyleAssertions.playerDialog);
        await captureScreenshot(browser, 'player-active-states');

        await navigate(browser, '/tags', MOBILE_VIEWPORT);
        await waitFor(browser.client, 'tag list', `Boolean(document.querySelector('button[aria-label="Select"]'))`);
        await evaluate(browser.client, pageStyleAssertions.tagsEnterSelectMode);
        await waitFor(browser.client, 'selectable tag rows', `Boolean(document.querySelector('button[aria-label^="Select "]'))`);
        await evaluate(browser.client, pageStyleAssertions.tagsSelectFirst);
        await waitFor(browser.client, 'selected tag row', `Boolean(document.querySelector('button[aria-label^="Unselect "][aria-pressed="true"]'))`);
        await sleep(250);
        await evaluate(browser.client, pageStyleAssertions.tags);
        await captureScreenshot(browser, 'tags-selection-mobile');

        await navigate(browser, '/queue', MOBILE_VIEWPORT);
        await waitFor(browser.client, 'queue rows', `document.querySelectorAll('li[data-queue-index]').length >= 2`);
        await evaluate(browser.client, pageStyleAssertions.queueMoveFirstDown);
        await waitFor(browser.client, 'queue keyboard reorder', `window.__runtimeQueueBefore !== [...document.querySelectorAll('li[data-queue-index]')].map((row) => row.textContent).join('|')`);
        await evaluate(browser.client, pageStyleAssertions.queue);
        await captureScreenshot(browser, 'queue-keyboard-reorder-mobile');

        assert.deepEqual(browser.runtimeErrors, [], browser.runtimeErrors.join('\n'));
    } finally {
        console.log(`Runtime UI screenshots: ${browser.screenshotDir}`);
        await browser.close();
    }
});
