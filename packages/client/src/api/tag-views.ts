import type { TagView } from '~/models/type';

import { graphQuery } from './graphql';
import {
    type OriginClientVariables,
    withOriginClientId
} from './origin-client';

const TAG_VIEW_FIELDS = `
    id
    scopeKey
    name
    normalizedName
    tagMode
    sortKey
    tagIds
    tags {
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
    }
    createdAt
    updatedAt
`;

export function fetchTagViews() {
    return graphQuery<{
        tagViews: {
            totalCount: number;
            views: TagView[];
        };
    }>(
        `query FetchTagViews {
            tagViews {
                totalCount
                views {
                    ${TAG_VIEW_FIELDS}
                }
            }
        }`
    );
}

export function createTagView({
    name,
    tagIds,
    tagMode
}: {
    name: string;
    tagIds: string[];
    tagMode: TagView['tagMode'];
}) {
    return graphQuery<{
        createTagView: TagView;
    }, {
        name: string;
        tagIds: string[];
        tagMode: TagView['tagMode'];
    } & OriginClientVariables>(
        `mutation CreateTagView(
            $name: String!,
            $tagIds: [ID!]!,
            $tagMode: String!,
            $originClientId: String
        ) {
            createTagView(
                name: $name,
                tagIds: $tagIds,
                tagMode: $tagMode,
                originClientId: $originClientId
            ) {
                ${TAG_VIEW_FIELDS}
            }
        }`,
        withOriginClientId({ name, tagIds, tagMode })
    );
}

export function renameTagView({ id, name }: { id: string; name: string }) {
    return graphQuery<{
        renameTagView: TagView;
    }, {
        id: string;
        name: string;
    } & OriginClientVariables>(
        `mutation RenameTagView($id: ID!, $name: String!, $originClientId: String) {
            renameTagView(id: $id, name: $name, originClientId: $originClientId) {
                ${TAG_VIEW_FIELDS}
            }
        }`,
        withOriginClientId({ id, name })
    );
}

export function deleteTagView(id: string) {
    return graphQuery<{
        deleteTagView: {
            id: string;
        };
    }, {
        id: string;
    } & OriginClientVariables>(
        `mutation DeleteTagView($id: ID!, $originClientId: String) {
            deleteTagView(id: $id, originClientId: $originClientId) {
                id
            }
        }`,
        withOriginClientId({ id })
    );
}
