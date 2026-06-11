import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const walkFiles = (directory, predicate) => {
    const files = [];

    for (const entry of readdirSync(directory)) {
        const fullPath = path.join(directory, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
            files.push(...walkFiles(fullPath, predicate));
            continue;
        }

        if (predicate(fullPath)) {
            files.push(fullPath);
        }
    }

    return files;
};

const readText = (...segments) => readFileSync(path.join(repoRoot, ...segments), 'utf8');

const formatViolations = (violations) =>
    violations
        .map(({ file, line, match }) => `${path.relative(repoRoot, file)}:${line} -> ${match}`)
        .join('\n');

const findViolations = (files, pattern) => {
    const violations = [];

    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        const lines = text.split('\n');

        lines.forEach((lineText, index) => {
            const matches = lineText.match(pattern);

            if (matches) {
                violations.push({
                    file,
                    line: index + 1,
                    match: matches[0]
                });
            }
        });
    }

    return violations;
};

const getLineNumber = (text, index) => text.slice(0, index).split('\n').length;

const extractCvaIdentifiers = (file) => {
    const text = readFileSync(file, 'utf8');
    const identifiers = [];
    const pattern = /\b(?:const|export\s+const)\s+([A-Za-z_$][\w$]*)\s*=\s*cva\s*\(/g;

    for (const match of text.matchAll(pattern)) {
        identifiers.push(match[1]);
    }

    return identifiers;
};

const extractJsxAttributeExpressions = (file, attributeName) => {
    const text = readFileSync(file, 'utf8');
    const expressions = [];
    const pattern = new RegExp(`${attributeName}=\\{`, 'g');

    for (const match of text.matchAll(pattern)) {
        const expressionStart = match.index + match[0].length;
        let depth = 1;
        let cursor = expressionStart;
        let quote = null;

        while (cursor < text.length && depth > 0) {
            const char = text[cursor];
            const prev = text[cursor - 1];

            if (quote) {
                if (char === quote && prev !== '\\') {
                    quote = null;
                }

                cursor += 1;
                continue;
            }

            if (char === '\'' || char === '"' || char === '`') {
                quote = char;
                cursor += 1;
                continue;
            }

            if (char === '{') {
                depth += 1;
            }

            if (char === '}') {
                depth -= 1;
            }

            cursor += 1;
        }

        expressions.push({
            file,
            line: getLineNumber(text, match.index),
            expression: text.slice(expressionStart, cursor - 1).trim()
        });
    }

    return expressions;
};

const clientUiFiles = walkFiles(path.join(repoRoot, 'packages', 'client', 'src'), (file) => (
    /\.(tsx|ts)$/.test(file) &&
    (
        file.includes(`${path.sep}components${path.sep}`) ||
        file.includes(`${path.sep}pages${path.sep}`)
    ) &&
    !file.includes(`${path.sep}visualizers${path.sep}`)
));

const mobileComponentFiles = walkFiles(path.join(repoRoot, 'packages', 'mobile', 'src', 'components'), (file) => (
    /\.tsx$/.test(file)
));

const visualizerRendererFiles = walkFiles(path.join(repoRoot, 'packages', 'client', 'src', 'components', 'music', 'MusicPlayerVisualizerStyle', 'visualizers'), (file) => (
    /\.ts$/.test(file) &&
    !file.endsWith(`${path.sep}types.ts`) &&
    !file.endsWith('.test.ts')
));

test('client UI classes use design tokens instead of raw Tailwind palette, radius, and shadow utilities', () => {
    const rawTailwindUtilityPattern = /\b(?:rounded-(?:xs|sm|md|lg|xl|2xl|3xl)|(?:bg|text|border|fill|stroke|from|via|to)-(?:red|blue|green|purple|violet|zinc|slate|neutral|black|white|gray|rose|orange|amber|yellow|lime|emerald|teal|cyan|sky|indigo|fuchsia|pink)(?:\b|[-/])|shadow-(?:sm|md|lg|xl|2xl))\b/;
    const violations = findViolations(clientUiFiles, rawTailwindUtilityPattern);

    assert.equal(violations.length, 0, formatViolations(violations));
});

test('client UI component and page files do not embed literal colors outside token definitions', () => {
    const literalColorPattern = /(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|(?<![\w-])(?:black|white)(?![\w-]))/;
    const violations = findViolations(clientUiFiles, literalColorPattern);

    assert.equal(violations.length, 0, formatViolations(violations));
});

test('conditional className logic goes through cx or cva-backed variant helpers', () => {
    const cvaVariantHelpers = new Set(clientUiFiles.flatMap((file) => extractCvaIdentifiers(file)));
    const classNameExpressions = clientUiFiles.flatMap((file) => extractJsxAttributeExpressions(file, 'className'));
    const conditionalClassNamePattern = /(?:\?|&&|\|\|)/;
    const getCallExpressionName = (expression) => expression.match(/^([A-Za-z_$][\w$]*)\s*\(/)?.[1] ?? null;
    const isAllowedHelper = (expression) => {
        const helperName = getCallExpressionName(expression);

        return helperName === 'cx' ||
            helperName === 'classNames' ||
            (helperName !== null && cvaVariantHelpers.has(helperName));
    };
    const violations = classNameExpressions
        .filter(({ expression }) => conditionalClassNamePattern.test(expression))
        .filter(({ expression }) => !isAllowedHelper(expression));

    assert.equal(violations.length, 0, formatViolations(violations.map(({ file, line, expression }) => ({
        file,
        line,
        match: expression.split('\n')[0]
    }))));
});

test('active icon states keep shuffle, like, and selection feedback distinct', () => {
    const iconButton = readText('packages', 'client', 'src', 'components', 'shared', 'IconButton', 'IconButton.tsx');
    const iconTextButton = readText('packages', 'client', 'src', 'components', 'shared', 'IconTextButton', 'IconTextButton.tsx');
    const panelContent = readText('packages', 'client', 'src', 'components', 'shared', 'PanelContent.tsx');
    const player = readText('packages', 'client', 'src', 'pages', 'Player.tsx');
    const selectionCheckButton = readText('packages', 'client', 'src', 'components', 'shared', 'ListSelectionToolbar', 'SelectionCheckButton.tsx');
    const iconStateClass = readText('packages', 'client', 'src', 'components', 'shared', 'iconStateClass.ts');
    const tailwindCss = readText('packages', 'client', 'src', 'styles', 'tailwind.css');

    assert.match(iconButton, /active:\s*\{\s*true:\s*activeIconClassName/s, 'IconButton active state should be icon-only for controls like shuffle');
    assert.doesNotMatch(iconButton, /active:\s*\{\s*true:\s*['"`][\s\S]*?bg-\[var\(--b-color-active\)\]/, 'IconButton active state should not add an active background');

    assert.match(tailwindCss, /\.ow-active-background[\s\S]*?background-color:\s*var\(--b-color-active\)/, 'Active background utility should resolve through the active token');
    assert.match(tailwindCss, /\.ow-active-surface[\s\S]*?box-shadow:\s*var\(--b-shadow-inset-selected\)/, 'Active surface utility should include the selected inset shadow');
    assert.match(iconTextButton, /active:\s*\{\s*true:\s*`[\s\S]*?ow-active-background[\s\S]*?\$\{activeIconClassName\}/, 'IconTextButton active state should keep the subtle active background');
    assert.match(panelContent, /active:\s*\{\s*true:\s*`[\s\S]*?ow-active-background[\s\S]*?\$\{activeIconClassName\}/, 'Panel actions should keep the same active background as text-icon actions');
    assert.match(player, /size="controlLg"\s+tone="gradient"/, 'Player detail play button should keep the shared primary CTA tone');

    assert.match(iconStateClass, /\[&_path\]:!fill-\[var\(--b-color-point\)\]/, 'Filled active heart path should use the point fill');
    assert.match(iconStateClass, /\[&_path\]:!stroke-\[var\(--b-color-point\)\]/, 'Filled active heart path should use the point stroke');
    assert.match(iconStateClass, /\[&_svg\]:!fill-\[var\(--b-color-point\)\]/, 'Filled active svg should use the point fill');
    assert.match(iconStateClass, /\[&_svg\]:!stroke-\[var\(--b-color-point\)\]/, 'Filled active svg should use the point stroke');

    assert.match(selectionCheckButton, /selected:\s*\{\s*true:\s*'[\s\S]*?ow-active-surface/, 'Selected checkbox buttons should keep the subtle active background');
    assert.match(selectionCheckButton, /selected:\s*\{\s*true:\s*'text-\[var\(--b-color-point\)\]'/, 'Selected checkbox icons should use point color');
});

test('visualizer renderers use centralized palette helpers instead of literal colors', () => {
    const literalColorPattern = /(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/;
    const violations = findViolations(visualizerRendererFiles, literalColorPattern);

    assert.equal(violations.length, 0, formatViolations(violations));
});

test('mobile components consume brand tokens instead of embedding literal colors', () => {
    const literalColorPattern = /(?:#[0-9a-fA-F]{3,8}\b|rgba?\()/;
    const violations = findViolations(mobileComponentFiles, literalColorPattern);

    assert.equal(violations.length, 0, formatViolations(violations));
});

test('mobile playlist density uses brand layout tokens for shared measurements', () => {
    const playlistPlayer = readText('packages', 'mobile', 'src', 'components', 'PlaylistPlayerScreen.tsx');
    const directDensityPattern = /\b(?:syncDot|playlistChip|addPlaylistIcon|skeleton(?:Badge|Duration|Meta|Title|TrackMeta|TrackTitle)):\s*\{[^}]*\b(?:width|height):\s*\d/;

    assert.doesNotMatch(playlistPlayer, directDensityPattern);
});

test('shared UI barrel keeps the app-level design primitives public', () => {
    const sharedIndex = readText('packages', 'client', 'src', 'components', 'shared', 'index.ts');
    const expectedExports = [
        'ActionBar',
        'ActionBarButton',
        'Button',
        'IconButton',
        'IconTextButton',
        'CompactTrackRow',
        'LibraryActionCard',
        'libraryRowClass',
        'listRowActionRailClass',
        'listRowButtonContentClass',
        'listRowClass',
        'listRowIconClass',
        'ListSelectionToolbar',
        'PanelHeaderAction',
        'SectionEmptyState',
        'SectionHeader',
        'SectionHeaderAction',
        'SegmentedControl',
        'Select',
        'SelectionCheckButton',
        'SelectionCheckIndicator',
        'StateMessage',
        'Surface',
        'Tag',
        'TagButton',
        'Toggle'
    ];

    for (const exportName of expectedExports) {
        assert.match(sharedIndex, new RegExp(`\\b${exportName}\\b`), `${exportName} is not exported from shared UI`);
    }
});

test('tag and queue item rows reuse the shared ListRow primitive', () => {
    const tagList = readText('packages', 'client', 'src', 'pages', 'TagList.tsx');
    const queueItem = readText('packages', 'client', 'src', 'pages', 'Queue', 'QueueItem.tsx');
    const playlistDetail = readText('packages', 'client', 'src', 'pages', 'PlaylistDetail.tsx');

    assert.match(tagList, /\blistRowClass\b/, 'TagList should use shared ListRow row variants');
    assert.match(queueItem, /\blistRowClass\b/, 'QueueItem should use shared ListRow row variants');
    assert.match(playlistDetail, /\blistRowClass\b/, 'PlaylistDetail should use shared ListRow row variants for selectable songs');
    assert.doesNotMatch(tagList, /\btagList(?:Item)?RowClass\b/, 'TagList should not keep page-local row variants');
    assert.doesNotMatch(queueItem, /\bqueueItemClass\b/, 'QueueItem should not keep page-local row variants');
    assert.doesNotMatch(playlistDetail, /\bplaylistMusicSelectionRowClass\b/, 'PlaylistDetail should not keep page-local selectable row variants');
});

test('interactive navigation and segmented tabs expose accessibility feedback', () => {
    const segmentedControl = readText('packages', 'client', 'src', 'components', 'shared', 'SegmentedControl', 'SegmentedControl.tsx');
    const searchField = readText('packages', 'client', 'src', 'components', 'shared', 'SearchField', 'SearchField.tsx');
    const siteHeader = readText('packages', 'client', 'src', 'components', 'shared', 'SiteHeader', 'SiteHeader.tsx');

    assert.match(segmentedControl, /onKeyDown=\{\(event\) => handleTabKeyDown\(event, index\)\}/, 'SegmentedControl tabs should support keyboard roving');
    assert.match(segmentedControl, /tabIndex=\{variant === 'tabs' \? selected \? 0 : -1 : undefined\}/, 'SegmentedControl tabs should expose one focusable tab');
    assert.match(segmentedControl, /ow-active-background/, 'SegmentedControl surface active state should use the shared active background token');
    assert.match(searchField, /min-h-8 min-w-8/, 'SearchField clear action should keep at least a 32px target');
    assert.match(siteHeader, /aria-current=\{active \? 'page' : undefined\}/, 'SiteHeader should expose the current page to assistive tech');
});

test('mobile mini player progress is adjustable for assistive technologies', () => {
    const miniPlayer = readText('packages', 'mobile', 'src', 'components', 'MiniPlayer.tsx');
    const playbackControls = readText('packages', 'mobile', 'src', 'hooks', 'useTrackPlaybackControls.ts');
    const app = readText('packages', 'mobile', 'App.tsx');

    assert.match(miniPlayer, /accessibilityRole="adjustable"/, 'MiniPlayer seek control should be adjustable, not a passive progressbar');
    assert.match(miniPlayer, /accessibilityActions=\{\[/, 'MiniPlayer seek control should expose increment and decrement actions');
    assert.match(miniPlayer, /onAccessibilityAction=\{event =>/, 'MiniPlayer seek control should handle accessibility seek actions');
    assert.match(playbackControls, /\bseekByStep\b/, 'Playback controls should provide an accessible seek step handler');
    assert.match(app, /onSeekByStep=\{seekByStep\}/, 'App should pass the accessible seek step handler to the mini player flow');
});

test('runtime UI smoke is connected to local and CI verification', () => {
    const packageJson = readText('package.json');
    const ciWorkflow = readText('.github', 'workflows', 'CI.yml');
    const managedRuntime = readText('scripts', 'test', 'runtime-ui-managed.mjs');

    assert.match(packageJson, /"test:runtime-ui:managed": "node scripts\/test\/runtime-ui-managed\.mjs"/, 'Managed runtime UI smoke script should be public');
    assert.match(packageJson, /"test:ci": ".*pnpm test:runtime-ui:managed/, 'test:ci should include managed runtime UI smoke');
    assert.match(ciWorkflow, /Test \(Runtime UI Smoke\)[\s\S]*pnpm test:runtime-ui:managed/, 'CI should run managed runtime UI smoke');
    assert.match(managedRuntime, /seed-runtime-ui\.ts/, 'Managed runtime UI smoke should seed deterministic data when it starts the app');
});

test('music action panels do not render empty navigation headers', () => {
    const musicActionPanel = readText('packages', 'client', 'src', 'components', 'music', 'MusicActionPanelContent.tsx');

    assert.match(musicActionPanel, /const header = \(onAlbumClick \|\| onArtistClick\) \?/, 'MusicActionPanelContent should only pass a header when navigation actions exist');
    assert.match(musicActionPanel, /header=\{header\}/, 'MusicActionPanelContent should pass the resolved optional header');
});

test('player audio menu uses shared dialog primitives instead of page-local modal chrome', () => {
    const player = readText('packages', 'client', 'src', 'pages', 'Player.tsx');

    assert.match(player, /@baejino\/react-ui\/modal\/dialog/, 'Player audio menu should use the shared Dialog primitive');
    assert.match(player, /\bDialog\.Root\b/, 'Player audio menu should be mounted through Dialog.Root');
    assert.match(player, /\bdialogOverlayClass\(\{ layer: 'form', tone: 'strong' \}\)/, 'Player audio menu overlay should reuse DialogShell overlay tokens');
    assert.match(player, /\bdialogContentClass\(\{ layer: 'form', width: 'form', padding: 'form' \}\)/, 'Player audio menu content should reuse DialogShell content tokens');
    assert.match(player, /onCloseAutoFocus=\{\(event\) => \{[\s\S]*?audioMenuTriggerRef\.current\?\.focus\(\);[\s\S]*?\}\}/, 'Player audio menu should restore focus to its trigger after dismiss');
    assert.doesNotMatch(player, /role="dialog"/, 'Player should not hand-roll dialog semantics');
    assert.doesNotMatch(player, /aria-modal="true"/, 'Player should not hand-roll modal semantics');
    assert.doesNotMatch(player, /window\.addEventListener\('keydown'/, 'Player should not hand-roll Escape dismissal for dialogs');
});
