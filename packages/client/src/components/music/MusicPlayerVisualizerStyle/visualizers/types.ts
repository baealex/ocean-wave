export type RenderVisualizer = (
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    bufferLength: number,
    dataArray: Uint8Array,
    palette?: VisualizerPalette
) => void;

export interface RGB {
    r: number;
    g: number;
    b: number;
}

export interface VisualizerPalette {
    hueStart: number;
    hueRange: number;
    saturation: number;
    lightnessBase: number;
    lightnessRange: number;
    glowHue: number;
    scrimAlpha: number;
    underlayAlpha: number;
}

const IDENTITY_VIOLET_HUE = 258;
const ALBUM_HUE_IDENTITY_PULL = 0;
const VISUALIZER_NEUTRAL_SCRIM_RGB = '0, 0, 0';
const VISUALIZER_UNDERLAY_RGB = '12, 8, 20';
const VISUALIZER_CONTRAST_TOP_RGB = '14, 10, 24';
const VISUALIZER_CONTRAST_MID_RGB = '10, 8, 18';
const VISUALIZER_CONTRAST_BOTTOM_RGB = '8, 6, 14';

export const DEFAULT_VISUALIZER_PALETTE: VisualizerPalette = {
    hueStart: IDENTITY_VIOLET_HUE,
    hueRange: 0,
    saturation: 90,
    lightnessBase: 58,
    lightnessRange: 10,
    glowHue: IDENTITY_VIOLET_HUE,
    scrimAlpha: 0.22,
    underlayAlpha: 0.34
};

const normalizeHue = (hue: number) => ((hue % 360) + 360) % 360;

const getHueDelta = (from: number, to: number) => ((to - from + 540) % 360) - 180;

const mixHue = (from: number, to: number, amount: number) => normalizeHue(
    from + getHueDelta(from, to) * amount
);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getLuminance = ({ r, g, b }: RGB) => (
    0.2126 * r + 0.7152 * g + 0.0722 * b
) / 255;

const rgbToHue = ({ r, g, b }: RGB) => {
    const rChannel = r / 255;
    const gChannel = g / 255;
    const bChannel = b / 255;
    const max = Math.max(rChannel, gChannel, bChannel);
    const min = Math.min(rChannel, gChannel, bChannel);
    const delta = max - min;

    if (delta === 0) {
        return IDENTITY_VIOLET_HUE;
    }

    if (max === rChannel) {
        return normalizeHue(60 * (((gChannel - bChannel) / delta) % 6));
    }

    if (max === gChannel) {
        return normalizeHue(60 * ((bChannel - rChannel) / delta + 2));
    }

    return normalizeHue(60 * ((rChannel - gChannel) / delta + 4));
};

export const createVividVisualizerPalette = (accentColor?: RGB | null): VisualizerPalette => {
    const albumHue = accentColor ? rgbToHue(accentColor) : IDENTITY_VIOLET_HUE;
    const luminance = accentColor ? getLuminance(accentColor) : 0.5;
    const seedHue = accentColor
        ? mixHue(albumHue, IDENTITY_VIOLET_HUE, ALBUM_HUE_IDENTITY_PULL)
        : IDENTITY_VIOLET_HUE;

    return {
        hueStart: seedHue,
        hueRange: 0,
        saturation: 90,
        lightnessBase: 58,
        lightnessRange: 10,
        glowHue: seedHue - 12,
        scrimAlpha: clamp(0.14 + luminance * 0.18, 0.14, 0.32),
        underlayAlpha: clamp(0.24 + luminance * 0.2, 0.24, 0.44)
    };
};

export const hslaColor = (
    hue: number,
    saturation: number,
    lightness: number,
    alpha = 1
) => `hsla(${normalizeHue(hue)}, ${saturation}%, ${lightness}%, ${alpha})`;

export const visualizerColor = (
    palette: VisualizerPalette | undefined,
    normalizedAmplitude: number,
    alpha = 1
) => {
    const resolvedPalette = palette ?? DEFAULT_VISUALIZER_PALETTE;
    const hue = resolvedPalette.hueStart + normalizedAmplitude * resolvedPalette.hueRange;
    const lightness = resolvedPalette.lightnessBase + normalizedAmplitude * resolvedPalette.lightnessRange;

    return hslaColor(hue, resolvedPalette.saturation, lightness, alpha);
};

export const visualizerUnderlayColor = (
    palette: VisualizerPalette | undefined,
    alpha = 1
) => {
    const resolvedPalette = palette ?? DEFAULT_VISUALIZER_PALETTE;

    return `rgba(${VISUALIZER_UNDERLAY_RGB}, ${resolvedPalette.underlayAlpha * alpha})`;
};

export const visualizerNeutralScrimColor = (alpha: number) => `rgba(${VISUALIZER_NEUTRAL_SCRIM_RGB}, ${alpha})`;

export const drawVisualizerContrastLayer = (
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    palette?: VisualizerPalette
) => {
    const resolvedPalette = palette ?? DEFAULT_VISUALIZER_PALETTE;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.max(canvas.width, canvas.height) * 0.72;

    ctx.save();

    const scrim = ctx.createLinearGradient(0, 0, 0, canvas.height);
    scrim.addColorStop(0, `rgba(${VISUALIZER_CONTRAST_TOP_RGB}, ${resolvedPalette.scrimAlpha * 0.7})`);
    scrim.addColorStop(0.55, `rgba(${VISUALIZER_CONTRAST_MID_RGB}, ${resolvedPalette.scrimAlpha * 0.36})`);
    scrim.addColorStop(1, `rgba(${VISUALIZER_CONTRAST_BOTTOM_RGB}, ${resolvedPalette.scrimAlpha})`);
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const primaryWash = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    primaryWash.addColorStop(0, hslaColor(resolvedPalette.glowHue, 100, 62, resolvedPalette.scrimAlpha * 0.22));
    primaryWash.addColorStop(0.62, hslaColor(resolvedPalette.glowHue, 100, 54, resolvedPalette.scrimAlpha * 0.06));
    primaryWash.addColorStop(1, visualizerNeutralScrimColor(resolvedPalette.scrimAlpha * 0.24));
    ctx.fillStyle = primaryWash;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.restore();
};
