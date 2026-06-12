import { useEffect, useMemo, useRef, useState } from 'react';

import { Image } from '~/components/shared';
import { getOriginalImage } from '~/modules/image';
import { webAudioContext } from '~/modules/web-audio-context';

import {
    line,
    round
} from './visualizers';
import {
    createVividVisualizerPalette,
    type RGB
} from './visualizers/types';

interface MusicPlayerVisualizerStyleProps {
    type: string;
    isPlaying: boolean;
    src: string;
    alt: string;
}

const parseCssRgbColor = (color: string): RGB | null => {
    const value = color.trim();
    const hex = value.match(/^#([0-9a-f]{6})$/i);

    if (hex) {
        const colorValue = Number.parseInt(hex[1], 16);

        return {
            r: (colorValue >> 16) & 255,
            g: (colorValue >> 8) & 255,
            b: colorValue & 255
        };
    }

    const rgb = value.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);

    if (!rgb) {
        return null;
    }

    return {
        r: Number(rgb[1]),
        g: Number(rgb[2]),
        b: Number(rgb[3])
    };
};

const getPointColor = () => {
    if (typeof window === 'undefined') {
        return null;
    }

    return parseCssRgbColor(getComputedStyle(document.documentElement).getPropertyValue('--b-color-point'));
};

const MusicPlayerVisualizerStyle = ({ type, src, alt }: MusicPlayerVisualizerStyleProps) => {
    const ref = useRef<HTMLCanvasElement>(null);
    const bufferLength = 144;
    const dataArray = useMemo(() => new Uint8Array(bufferLength), []);
    const [accentColor, setAccentColor] = useState<RGB | null>(null);
    const palette = useMemo(() => createVividVisualizerPalette(accentColor), [accentColor]);

    useEffect(() => {
        setAccentColor(getPointColor());
    }, []);

    const draw = (ctx: CanvasRenderingContext2D) => {
        if (!ref.current) return;

        const canvas = ref.current;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        webAudioContext.getAnalyser()?.getByteFrequencyData(dataArray);

        switch (type) {
            case 'line':
                line(canvas, ctx, bufferLength, dataArray, palette);
                break;
            default:
                round(canvas, ctx, bufferLength, dataArray, palette);
                break;
        }
    };

    useEffect(() => {
        if (!ref.current) return;

        const canvas = ref.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationId = 0;

        const animate = () => {
            draw(ctx);
            animationId = requestAnimationFrame(animate);
        };

        animationId = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(animationId);
        };
    }, [dataArray, palette, type]);

    return (
        <div className="relative aspect-square h-full w-full">
            <div className="absolute inset-0 z-0 aspect-square overflow-hidden rounded-[var(--b-radius-player-visualizer)]">
                <Image
                    className="absolute inset-0 h-full w-full rounded-[var(--b-radius-player-visualizer)] object-cover"
                    src={getOriginalImage(src)}
                    alt={alt}
                />
            </div>
            <canvas
                ref={ref}
                className="pointer-events-none absolute left-0 top-0 z-[1] h-full w-full rounded-[var(--b-radius-player-visualizer)]"
                width={900}
                height={900}
            />
        </div>
    );
};

export default MusicPlayerVisualizerStyle;
