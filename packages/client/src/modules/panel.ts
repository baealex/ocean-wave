import { BaseStore } from '~/store/base-store';

interface PanelStoreState {
    title: string;
    isOpen: boolean;
    content: React.ReactNode;
}

export class PanelStore extends BaseStore<PanelStoreState> {
    private afterClose: (() => void) | null = null;

    constructor() {
        super();
        this.state = {
            title: '',
            isOpen: false,
            content: null
        };
    }

    open({ title, content }: { title?: string; content: React.ReactNode }) {
        this.afterClose = null;
        this.set({
            title: title || '',
            isOpen: true,
            content
        });
    }

    close(afterClose?: () => void) {
        if (afterClose) {
            this.afterClose = afterClose;
        } else if (this.state.isOpen) {
            this.afterClose = null;
        }

        this.set({
            title: '',
            isOpen: false,
            content: null
        });
    }

    completeClose() {
        const afterClose = this.afterClose;

        this.afterClose = null;
        afterClose?.();
    }
}

export const panel = new PanelStore();
