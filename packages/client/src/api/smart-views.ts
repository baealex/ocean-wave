import type { SmartView } from '~/models/type';

import { graphQuery } from './graphql';
import {
    type OriginClientVariables,
    withOriginClientId
} from './origin-client';

const SMART_VIEW_FIELDS = `
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

export function fetchSmartViews() {
    return graphQuery<{
        smartViews: {
            totalCount: number;
            views: SmartView[];
        };
    }>(
        `query FetchSmartViews {
            smartViews {
                totalCount
                views {
                    ${SMART_VIEW_FIELDS}
                }
            }
        }`
    );
}

export function createSmartView({
    name,
    tagIds,
    tagMode
}: {
    name: string;
    tagIds: string[];
    tagMode: SmartView['tagMode'];
}) {
    return graphQuery<{
        createSmartView: SmartView;
    }, {
        name: string;
        tagIds: string[];
        tagMode: SmartView['tagMode'];
    } & OriginClientVariables>(
        `mutation CreateSmartView(
            $name: String!,
            $tagIds: [ID!]!,
            $tagMode: String!,
            $originClientId: String
        ) {
            createSmartView(
                name: $name,
                tagIds: $tagIds,
                tagMode: $tagMode,
                originClientId: $originClientId
            ) {
                ${SMART_VIEW_FIELDS}
            }
        }`,
        withOriginClientId({ name, tagIds, tagMode })
    );
}

export function renameSmartView({ id, name }: { id: string; name: string }) {
    return graphQuery<{
        renameSmartView: SmartView;
    }, {
        id: string;
        name: string;
    } & OriginClientVariables>(
        `mutation RenameSmartView($id: ID!, $name: String!, $originClientId: String) {
            renameSmartView(id: $id, name: $name, originClientId: $originClientId) {
                ${SMART_VIEW_FIELDS}
            }
        }`,
        withOriginClientId({ id, name })
    );
}

export function deleteSmartView(id: string) {
    return graphQuery<{
        deleteSmartView: {
            id: string;
        };
    }, {
        id: string;
    } & OriginClientVariables>(
        `mutation DeleteSmartView($id: ID!, $originClientId: String) {
            deleteSmartView(id: $id, originClientId: $originClientId) {
                id
            }
        }`,
        withOriginClientId({ id })
    );
}
