type PlaybackCommandBarrierPhase = 'executing' | 'recovering';

let activeCommandKey: string | null = null;
let activePhase: PlaybackCommandBarrierPhase | null = null;
const activeControllerCommandBarriers = new Set<symbol>();

export const beginPlaybackCommandBarrier = (commandKey: string) => {
    if (activeControllerCommandBarriers.size > 0) {
        return false;
    }

    if (activeCommandKey && activeCommandKey !== commandKey) {
        return false;
    }

    activeCommandKey = commandKey;
    activePhase = 'executing';
    return true;
};

export const beginPlaybackCommandRecovery = (commandKey: string) => {
    if (activeCommandKey !== commandKey) {
        return false;
    }

    activePhase = 'recovering';
    return true;
};

export const endPlaybackCommandBarrier = (commandKey: string) => {
    if (activeCommandKey === commandKey) {
        activeCommandKey = null;
        activePhase = null;
    }
};

export const isPlaybackCommandBarrierActive = () => activeCommandKey !== null;

export const isPlaybackCommandExecutionBarrierActive = () => (
    activePhase === 'executing'
);

export const beginPlaybackControllerCommandBarrier = (barrier: symbol) => {
    if (activeControllerCommandBarriers.has(barrier)) {
        return true;
    }

    if (activeCommandKey) {
        return false;
    }

    activeControllerCommandBarriers.add(barrier);
    return true;
};

export const endPlaybackControllerCommandBarrier = (barrier: symbol) => {
    activeControllerCommandBarriers.delete(barrier);
};

export const isPlaybackControllerCommandBarrierActive = () => (
    activeControllerCommandBarriers.size > 0
);

export const isLocalPlaybackMutationBarrierActive = () => (
    isPlaybackCommandExecutionBarrierActive()
    || isPlaybackControllerCommandBarrierActive()
);

export const getPlaybackCommandBarrierKey = () => activeCommandKey;
