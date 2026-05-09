export function formatDuration(duration?: number | null) {
  if (!duration) return '--:--';
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}
