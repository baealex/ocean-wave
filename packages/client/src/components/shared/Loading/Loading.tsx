import { useEffect, useState } from 'react';

const waveDelays = ['0ms', '200ms', '400ms', '600ms', '800ms'];

const Loading = () => {
    const [shouldShow, setShouldShow] = useState(false);

    useEffect(() => {
        const timeout = setTimeout(() => {
            setShouldShow(true);
        }, 100);

        return () => clearTimeout(timeout);
    });

    return (
        shouldShow && (
            <div
                className="flex flex-1 items-center justify-center"
                role="status"
                aria-live="polite"
                aria-label="Loading">
                <div className="flex h-10 w-15 items-center justify-between gap-2" aria-hidden="true">
                    {waveDelays.map((delay) => (
                        <div
                            key={delay}
                            className="block h-1.5 w-2.5 rounded-[var(--b-radius-lg)] bg-[var(--b-color-point-dark)] animate-[audio-wave_2.2s_infinite_ease-in-out] motion-reduce:h-3 motion-reduce:animate-none motion-reduce:transform-none"
                            style={{ animationDelay: delay }}
                        />
                    ))}
                </div>
            </div>
        )
    );
};

export default Loading;
