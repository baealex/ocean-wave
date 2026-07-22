import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const getReducedMotionPreference = () => {
    return typeof window !== 'undefined'
        && window.matchMedia(REDUCED_MOTION_QUERY).matches;
};

export default function useReducedMotion() {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(
        getReducedMotionPreference
    );

    useEffect(() => {
        const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
        const handleChange = (event: MediaQueryListEvent) => {
            setPrefersReducedMotion(event.matches);
        };

        setPrefersReducedMotion(mediaQuery.matches);
        mediaQuery.addEventListener('change', handleChange);

        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    return prefersReducedMotion;
}
