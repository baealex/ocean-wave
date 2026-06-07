import type {
    Music,
    Tag
} from '~/models/type';

import { graphQuery } from './graphql';
import {
    type OriginClientVariables,
    withOriginClientId
} from './origin-client';

const TAG_FIELDS = `
    id
    scopeKey
    name
    normalizedName
    color
    description
    order
    musicCount
    smartViewCount
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
    unusedOnly?: boolean;
}

export function fetchTags({
    query = '',
    limit = 100,
    offset = 0,
    unusedOnly = false
}: FetchTagsParams = {}) {
    return graphQuery<{
        allTags: {
            totalCount: number;
            tags: Tag[];
        };
    }, {
        searchFilter: {
            query: string;
            unusedOnly?: boolean;
        };
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
            searchFilter: unusedOnly
                ? { query, unusedOnly }
                : { query },
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
    return graphQuery<{ createTag: Tag }, CreateTagParams & OriginClientVariables>(
        `mutation CreateTag(
            $name: String!,
            $color: String,
            $description: String,
            $originClientId: String
        ) {
            createTag(
                name: $name,
                color: $color,
                description: $description,
                originClientId: $originClientId
            ) {
                ${TAG_FIELDS}
            }
        }`,
        withOriginClientId({ name, color, description })
    );
}

export function renameTag({ id, name }: { id: string; name: string }) {
    return graphQuery<{ renameTag: Tag }, { id: string; name: string } & OriginClientVariables>(
        `mutation RenameTag($id: ID!, $name: String!, $originClientId: String) {
            renameTag(id: $id, name: $name, originClientId: $originClientId) {
                ${TAG_FIELDS}
            }
        }`,
        withOriginClientId({ id, name })
    );
}

export function deleteTag(id: string) {
    return graphQuery<{
        deleteTag: {
            id: string;
            affectedMusicIds: string[];
            affectedSmartViewIds: string[];
        };
    }, { id: string } & OriginClientVariables>(
        `mutation DeleteTag($id: ID!, $originClientId: String) {
            deleteTag(id: $id, originClientId: $originClientId) {
                id
                affectedMusicIds
                affectedSmartViewIds
            }
        }`,
        withOriginClientId({ id })
    );
}

export function addTagToMusic({ musicId, tagId }: { musicId: string; tagId: string }) {
    return graphQuery<{
        addTagToMusic: Pick<Music, 'id' | 'tags'>;
    }, { musicId: string; tagId: string } & OriginClientVariables>(
        `mutation AddTagToMusic($musicId: ID!, $tagId: ID!, $originClientId: String) {
            addTagToMusic(musicId: $musicId, tagId: $tagId, originClientId: $originClientId) {
                ${MUSIC_TAG_FIELDS}
            }
        }`,
        withOriginClientId({ musicId, tagId })
    );
}

export function createAndAddTagToMusic({ musicId, name }: { musicId: string; name: string }) {
    return graphQuery<{
        createAndAddTagToMusic: Pick<Music, 'id' | 'tags'>;
    }, { musicId: string; name: string } & OriginClientVariables>(
        `mutation CreateAndAddTagToMusic($musicId: ID!, $name: String!, $originClientId: String) {
            createAndAddTagToMusic(musicId: $musicId, name: $name, originClientId: $originClientId) {
                ${MUSIC_TAG_FIELDS}
            }
        }`,
        withOriginClientId({ musicId, name })
    );
}

export function removeTagFromMusic({ musicId, tagId }: { musicId: string; tagId: string }) {
    return graphQuery<{
        removeTagFromMusic: Pick<Music, 'id' | 'tags'>;
    }, { musicId: string; tagId: string } & OriginClientVariables>(
        `mutation RemoveTagFromMusic($musicId: ID!, $tagId: ID!, $originClientId: String) {
            removeTagFromMusic(musicId: $musicId, tagId: $tagId, originClientId: $originClientId) {
                ${MUSIC_TAG_FIELDS}
            }
        }`,
        withOriginClientId({ musicId, tagId })
    );
}
