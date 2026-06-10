import { Button } from '~/components/shared';
import { useBack } from '~/hooks';

export default function NotFound() {
    const back = useBack();

    return (
        <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="text-[28px] font-bold text-[var(--b-color-text)]">
                404
            </div>
            <div className="text-base text-[var(--b-color-text-tertiary)]">
                Page not found
            </div>
            <Button onClick={back}>
                Go back
            </Button>
        </div>
    );
}
