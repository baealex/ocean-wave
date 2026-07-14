export function formatDuration(duration?: number | null) {
  if (duration == null || !Number.isFinite(duration)) return '--:--';
  const safeDuration = Math.max(0, duration);
  const minutes = Math.floor(safeDuration / 60);
  const seconds = Math.floor(safeDuration % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}
