export const MINI_PLAYER_TOAST_OFFSET_PROPERTY = '--app-mini-player-toast-offset';

export const observeMiniPlayerToastOffset = (
    miniPlayer: HTMLElement,
    root = document.documentElement
) => {
    let appliedOffset: string | null = null;
    const updateOffset = () => {
        const height = Math.ceil(miniPlayer.getBoundingClientRect().height);
        if (!Number.isFinite(height) || height <= 0) {
            return;
        }

        appliedOffset = `${height}px`;
        root.style.setProperty(MINI_PLAYER_TOAST_OFFSET_PROPERTY, appliedOffset);
    };

    updateOffset();
    const resizeObserver = typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateOffset);
    resizeObserver?.observe(miniPlayer);

    return () => {
        resizeObserver?.disconnect();
        if (
            appliedOffset
            && root.style.getPropertyValue(MINI_PLAYER_TOAST_OFFSET_PROPERTY) === appliedOffset
        ) {
            root.style.removeProperty(MINI_PLAYER_TOAST_OFFSET_PROPERTY);
        }
    };
};
