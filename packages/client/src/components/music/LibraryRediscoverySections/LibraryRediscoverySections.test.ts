import {
    createElement,
    type ImgHTMLAttributes,
    type ReactNode
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { Music } from '~/models/type';
import type { LibraryRediscoverySection } from '~/modules/library-rediscovery-sections';
import {
    REMOTE_PLAYBACK_OWNERSHIP_MESSAGE,
    REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
} from '~/modules/playback-ownership';

vi.mock('~/components/shared', () => ({
    CollectionCard: ({
        artwork,
        description,
        meta,
        title,
        to
    }: {
        artwork: ReactNode;
        description?: ReactNode;
        meta?: ReactNode;
        title: ReactNode;
        to: string;
    }) => createElement('a', { href: to }, artwork, title, description, meta),
    Image: (props: ImgHTMLAttributes<HTMLImageElement>) => createElement('img', props),
    SectionHeader: ({
        eyebrow,
        heading,
        headingId
    }: {
        eyebrow?: ReactNode;
        heading: ReactNode;
        headingId?: string;
    }) => createElement('header', null,
        eyebrow,
        createElement('h2', { id: headingId }, heading)
    )
}));

vi.mock('~/icon', () => ({
    Play: () => createElement('span')
}));

import LibraryRediscoverySections from './LibraryRediscoverySections';

const music = {
    album: {
        cover: '/cover.jpg',
        id: 'album-1',
        name: 'Tidal Memory'
    },
    artist: { name: 'Ocean Signals' },
    artistDisplayName: 'Ocean Signals',
    id: 'track-1',
    name: 'Midnight Current'
} as Music;

const sections: LibraryRediscoverySection[] = [{
    eyebrow: 'Rediscover',
    heading: 'Favorites worth revisiting',
    id: 'dormant-liked',
    items: [{
        kind: 'track',
        music,
        reason: {
            code: 'LIKED_NOT_RECENTLY_PLAYED',
            copy: 'Liked, but not played in a while'
        },
        score: 88
    }]
}, {
    eyebrow: 'From your shelves',
    heading: 'Albums you may have forgotten',
    id: 'forgotten-albums',
    items: [{
        album: {
            cover: '/forgotten.jpg',
            id: 'album-2',
            name: 'Low Tide Letters'
        },
        artistName: 'Harbor Lights',
        kind: 'album',
        reason: {
            code: 'FORGOTTEN_ALBUM',
            copy: 'Not played in a while'
        },
        representativeMusicId: 'track-2',
        score: 72,
        trackCount: 9
    }]
}];

const renderSections = (playbackBlocked = false) => renderToStaticMarkup(
    createElement(
        MemoryRouter,
        null,
        createElement(LibraryRediscoverySections, {
            onPlayTrack: vi.fn(),
            playbackBlocked,
            sections
        })
    )
);

describe('LibraryRediscoverySections', () => {
    it('renders explainable track and album cards with accessible destinations', () => {
        const markup = renderSections();

        expect(markup).toContain('Favorites worth revisiting');
        expect(markup).toContain('Albums you may have forgotten');
        expect(markup).toContain('data-reason-code="LIKED_NOT_RECENTLY_PLAYED"');
        expect(markup).toContain('Liked, but not played in a while');
        expect(markup).toContain(
            'aria-label="Play Midnight Current by Ocean Signals. Why this appears: Liked, but not played in a while"'
        );
        expect(markup).toContain('href="/album/album-2"');
        expect(markup).toContain('data-reason-code="FORGOTTEN_ALBUM"');
        expect(markup).toContain('9 tracks');
    });

    it('blocks track playback while preserving album navigation and the reason copy', () => {
        const markup = renderSections(true);

        expect(markup).toContain('disabled=""');
        expect(markup).toContain(`title="${REMOTE_PLAYBACK_OWNERSHIP_MESSAGE}"`);
        expect(markup).toContain(`aria-describedby="${REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID}"`);
        expect(markup).toContain(
            'aria-label="Play Midnight Current by Ocean Signals unavailable while another device owns playback. Why this appears: Liked, but not played in a while"'
        );
        expect(markup).toContain('href="/album/album-2"');
        expect(markup).toContain('Not played in a while');
    });
});
