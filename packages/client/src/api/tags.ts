import type {
    Music,
    Tag
} from '~/models/type';

import { graphQuery } from './graphql';

const TAG_FIELDS = `
    id
    scopeKey
    name
    normalizedName
    color
    description
    order
    musicCount
    createdAt
    updatedAt
`;

const MUSIC_TAG_FIELDS = `
    id
    tags {
        ${TAG_FIELDS}
    }
`;

export interface FetchTagsParams {
    query?: string;
    limit?: number;
    offset?: number;
}

export function fetchTags({
    query = '',
    limit = 100,
    offset = 0
}: FetchTagsParams = {}) {
    return graphQuery<{
        allTags: {
            totalCount: number;
            tags: Tag[];
        };
    }, {
        searchFilter: { query: string };
        pagination: { limit: number; offset: number };
    }>(
        `query FetchTags(
            $searchFilter: SearchFilterInput,
            $pagination: PaginationInput
        ) {
            allTags(
                searchFilter: $searchFilter,
                pagination: $pagination
            ) {
                totalCount
                tags {
                    ${TAG_FIELDS}
                }
            }
        }`,
        {
            searchFilter: { query },
            pagination: {
                limit,
                offset
            }
        }
    );
}

export interface CreateTagParams {
    name: string;
    color?: string | null;
    description?: string | null;
}

export function createTag({
    name,
    color = null,
    description = null
}: CreateTagParams) {
    return graphQuery<{ createTag: Tag }, CreateTagParams>(
        `mutation CreateTag(
            $name: String!,
            $color: String,
            $description: String
        ) {
            createTag(
                name: $name,
                color: $color,
                description: $description
            ) {
                ${TAG_FIELDS}
            }
        }`,
        { name, color, description }
    );
}

export function renameTag({ id, name }: { id: string; name: string }) {
    return graphQuery<{ renameTag: Tag }, { id: string; name: string }>(
        `mutation RenameTag($id: ID!, $name: String!) {
            renameTag(id: $id, name: $name) {
                ${TAG_FIELDS}
            }
        }`,
        { id, name }
    );
}

export function deleteTag(id: string) {
    return graphQuery<{
        deleteTag: {
            id: string;
            affectedMusicIds: string[];
            affectedSmartViewIds: string[];
        };
    }, { id: string }>(
        `mutation DeleteTag($id: ID!) {
            deleteTag(id: $id) {
                id
                affectedMusicIds
                affectedSmartViewIds
            }
        }`,
        { id }
    );
}

export function addTagToMusic({ musicId, tagId }: { musicId: string; tagId: string }) {
    return graphQuery<{ addTagToMusic: Pick<Music, 'id' | 'tags'> }, { musicId: string; tagId: string }>(
        `mutation AddTagToMusic($musicId: ID!, $tagId: ID!) {
            addTagToMusic(musicId: $musicId, tagId: $tagId) {
                ${MUSIC_TAG_FIELDS}
            }
        }`,
        { musicId, tagId }
    );
}

export function createAndAddTagToMusic({ musicId, name }: { musicId: string; name: string }) {
    return graphQuery<{ createAndAddTagToMusic: Pick<Music, 'id' | 'tags'> }, { musicId: string; name: string }>(
        `mutation CreateAndAddTagToMusic($musicId: ID!, $name: String!) {
            createAndAddTagToMusic(musicId: $musicId, name: $name) {
                ${MUSIC_TAG_FIELDS}
            }
        }`,
        { musicId, name }
    );
}

export function removeTagFromMusic({ musicId, tagId }: { musicId: string; tagId: string }) {
    return graphQuery<{ removeTagFromMusic: Pick<Music, 'id' | 'tags'> }, { musicId: string; tagId: string }>(
        `mutation RemoveTagFromMusic($musicId: ID!, $tagId: ID!) {
            removeTagFromMusic(musicId: $musicId, tagId: $tagId) {
                ${MUSIC_TAG_FIELDS}
            }
        }`,
        { musicId, tagId }
    );
}
