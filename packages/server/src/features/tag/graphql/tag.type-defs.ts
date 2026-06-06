import { gql } from '~/modules/graphql';

export const tagType = gql`
    input PaginationInput {
        limit: Int!
        offset: Int!
    }

    input SearchFilterInput {
        query: String!
    }

    type Tag {
        id: ID!
        scopeKey: String!
        name: String!
        normalizedName: String!
        color: String
        description: String
        order: Int!
        musicCount: Int!
        createdAt: String!
        updatedAt: String!
    }

    type Tags {
        totalCount: Int!
        tags: [Tag!]!
    }

    type TagDeleteResult {
        id: ID!
        affectedMusicIds: [ID!]!
        affectedSmartViewIds: [ID!]!
    }
`;

export const tagQuery = gql`
    type Query {
        allTags(searchFilter: SearchFilterInput, pagination: PaginationInput): Tags!
    }
`;

export const tagMutation = gql`
    type Mutation {
        createTag(name: String!, color: String, description: String, originClientId: String): Tag!
        renameTag(id: ID!, name: String!, originClientId: String): Tag!
        deleteTag(id: ID!, originClientId: String): TagDeleteResult!
        addTagToMusic(musicId: ID!, tagId: ID!, originClientId: String): Music!
        createAndAddTagToMusic(musicId: ID!, name: String!, originClientId: String): Music!
        removeTagFromMusic(musicId: ID!, tagId: ID!, originClientId: String): Music!
    }
`;

export const tagTypeDefs = `
    ${tagType}
    ${tagQuery}
    ${tagMutation}
`;
