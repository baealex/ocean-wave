import {
    visualizerColor,
    visualizerNeutralScrimColor,
    visualizerUnderlayColor,
    type RenderVisualizer
} from './types';

interface SpectrumPoint {
    x: number;
    y: number;
}

const drawConnectedPath = (
    ctx: CanvasRenderingContext2D,
    points: SpectrumPoint[]
) => {
    if (points.length < 2) {
        return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 1; i++) {
        const current = points[i];
        const next = points[i + 1];
        const controlX = (current.x + next.x) / 2;
        const controlY = (current.y + next.y) / 2;

        ctx.quadraticCurveTo(current.x, current.y, controlX, controlY);
    }

    const lastPoint = points[points.length - 1];
    ctx.lineTo(lastPoint.x, lastPoint.y);
};

const line: RenderVisualizer = (
    canvas,
    ctx,
    bufferLength,
    dataArray,
    palette
) => {
    const maxAmplitude = 255;

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, visualizerNeutralScrimColor(0));
    gradient.addColorStop(1, visualizerNeutralScrimColor(0.75));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const baseY = canvas.height * 0.9;
    const maxLineHeight = canvas.height * 0.3;
    const points: SpectrumPoint[] = [];

    for (let i = 0; i < bufferLength; i++) {
        const previous = dataArray[Math.max(0, i - 1)];
        const current = dataArray[i];
        const next = dataArray[Math.min(bufferLength - 1, i + 1)];
        const smoothedAmplitude = (previous + current * 1.6 + next) / 3.6;
        const normalizedAmplitude = Math.pow(smoothedAmplitude / maxAmplitude, 0.86);
        const x = (canvas.width / (bufferLength - 1)) * i;
        const y = baseY - normalizedAmplitude * maxLineHeight;

        points.push({ x, y });
    }

    const fillGradient = ctx.createLinearGradient(0, canvas.height * 0.28, 0, canvas.height);
    fillGradient.addColorStop(0, visualizerColor(palette, 0.86, 0.28));
    fillGradient.addColorStop(0.72, visualizerColor(palette, 0.54, 0.08));
    fillGradient.addColorStop(1, visualizerNeutralScrimColor(0));

    drawConnectedPath(ctx, points);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.lineTo(0, canvas.height);
    ctx.closePath();
    ctx.fillStyle = fillGradient;
    ctx.fill();

    drawConnectedPath(ctx, points);
    ctx.strokeStyle = visualizerUnderlayColor(palette, 0.8);
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    const lineGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    lineGradient.addColorStop(0, visualizerColor(palette, 0.22, 0.92));
    lineGradient.addColorStop(0.48, visualizerColor(palette, 0.64, 1));
    lineGradient.addColorStop(1, visualizerColor(palette, 0.98, 0.94));

    ctx.save();
    ctx.shadowBlur = 0;
    drawConnectedPath(ctx, points);
    ctx.strokeStyle = lineGradient;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    drawConnectedPath(ctx, points);
    ctx.strokeStyle = visualizerColor(palette, 0.94, 0.92);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
};

export default line;
