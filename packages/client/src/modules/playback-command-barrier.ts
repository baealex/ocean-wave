type PlaybackCommandBarrierPhase = 'executing' | 'recovering';

let activeCommandKey: string | null = null;
let activePhase: PlaybackCommandBarrierPhase | null = null;

export const beginPlaybackCommandBarrier = (commandKey: string) => {
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

export const getPlaybackCommandBarrierKey = () => activeCommandKey;
