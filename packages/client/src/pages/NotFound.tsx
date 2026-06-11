import { Button, StateMessage } from '~/components/shared';
import { useBack } from '~/hooks';

export default function NotFound() {
    const back = useBack();

    return (
        <div className="flex h-full items-center justify-center px-[var(--b-spacing-lg)]">
            <StateMessage
                heading="Page not found"
                description="The page you opened is not available."
                actions={(
                    <Button onClick={back}>
                        Go back
                    </Button>
                )}
            />
        </div>
    );
}
