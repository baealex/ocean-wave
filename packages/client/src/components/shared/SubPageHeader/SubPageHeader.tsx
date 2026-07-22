import { useBack } from '~/hooks';
import { ChevronLeft } from '~/icon';
import Button from '../Button';
import Text from '../Text';

const SubPageHeader = () => {
    const back = useBack();

    return (
        <div className="sticky top-0 z-[6] flex h-16 shrink-0 items-center justify-between border-b border-[var(--b-color-border-subtle)] bg-[var(--b-color-background)] px-3 lg:pointer-events-none lg:absolute lg:inset-x-0 lg:mx-auto lg:h-auto lg:w-[min(100%,1152px)] lg:border-b-0 lg:bg-transparent lg:px-[var(--b-spacing-lg)] lg:pt-[var(--b-spacing-lg)]">
            <Button
                variant="ghost"
                className="h-10 w-10 rounded-full !p-0 text-inherit lg:pointer-events-auto lg:w-auto lg:!px-3 [&_svg]:!h-5 [&_svg]:!w-5"
                aria-label="Back"
                onClick={back}>
                <ChevronLeft />
                <Text as="span" size="sm" weight="medium" className="ml-[var(--b-spacing-sm)] hidden lg:block">
                    Back
                </Text>
            </Button>
        </div>
    );
};

export default SubPageHeader;
