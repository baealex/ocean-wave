import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import queryClient from './configs/query-client';
import ModalProvider from '../ModalProvider';

interface ProvidersProps {
    children?: React.ReactNode;
}

const Providers = ({ children }: ProvidersProps) => {
    return (
        <QueryClientProvider client={queryClient}>
            <ModalProvider>
                {children}
            </ModalProvider>
        </QueryClientProvider>
    );
};

export default Providers;
