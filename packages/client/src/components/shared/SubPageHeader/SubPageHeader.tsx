import { useBack } from '~/hooks';
import { ChevronLeft } from '~/icon';
import Button from '../Button';
import Text from '../Text';

const SubPageHeader = () => {
    const back = useBack();

    return (
        <div className="flex h-16 items-center justify-between border-b border-[var(--b-color-border-subtle)] bg-[var(--b-color-background)] px-3 lg:h-full lg:border-b-0 lg:border-r lg:px-[var(--b-spacing-md)]">
            <Button
                variant="ghost"
                className="h-10 w-10 rounded-full p-0 text-inherit lg:h-auto lg:w-auto lg:px-3 [&_svg]:!h-5 [&_svg]:!w-5"
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
