import type {
    PersonalListeningSessionItem,
    PersonalListeningSessionLength,
    PersonalListeningSessionScope
} from '~/api/personal-listening-session';

import { BaseStore } from './base-store';

export interface ActivePersonalListeningSession {
    items: PersonalListeningSessionItem[];
    length: PersonalListeningSessionLength;
    queueRevision: number;
    scope: PersonalListeningSessionScope;
    startMusicId: string;
}

interface PersonalListeningSessionStoreState {
    active: ActivePersonalListeningSession | null;
}

class PersonalListeningSessionStore extends BaseStore<
    PersonalListeningSessionStoreState
> {
    constructor() {
        super();
        this.state = { active: null };
    }

    remember(active: ActivePersonalListeningSession) {
        this.set({ active });
    }

    clear() {
        this.set({ active: null });
    }
}

export const personalListeningSessionStore = new PersonalListeningSessionStore();
