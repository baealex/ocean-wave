export const MAX_AUDIO_RETRIES = 3;
export const audioRetryDelay = (attempt: number) => Math.min(1_000 * (2 ** Math.max(attempt - 1, 0)), 8_000);
export const withRetryToken = (resource: string, attempt: number) => {
    const url = new URL(resource, 'https://ocean-wave.invalid');
    url.searchParams.set('retry', String(attempt));
    return `${url.pathname}${url.search}`;
};
