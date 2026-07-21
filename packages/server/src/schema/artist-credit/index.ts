import { gql } from '~/modules/graphql';

export const artistCreditType = gql`
    enum ArtistCreditRole {
        PRIMARY
        FEATURED
        REMIXER
        PERFORMER
        COMPOSER
        CONDUCTOR
        UNKNOWN
    }

    type ArtistCredit {
        artist: Artist!
        role: ArtistCreditRole!
        position: Int!
        creditedName: String
        joinPhrase: String!
    }

    input ArtistCreditInput {
        name: String!
        role: ArtistCreditRole!
        creditedName: String
        joinPhrase: String
    }
`;
