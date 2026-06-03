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
        createTag(name: String!, color: String, description: String): Tag!
        renameTag(id: ID!, name: String!): Tag!
        deleteTag(id: ID!): TagDeleteResult!
        addTagToMusic(musicId: ID!, tagId: ID!): Music!
        createAndAddTagToMusic(musicId: ID!, name: String!): Music!
        removeTagFromMusic(musicId: ID!, tagId: ID!): Music!
    }
`;

export const tagTypeDefs = `
    ${tagType}
    ${tagQuery}
    ${tagMutation}
`;
