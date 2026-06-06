import { getOriginClientId } from '~/socket/socket';

export interface OriginClientVariables {
    originClientId?: string;
}

export const withOriginClientId = <TVariables extends object>(variables: TVariables): TVariables & OriginClientVariables => {
    const originClientId = getOriginClientId();

    if (!originClientId) {
        return variables;
    }

    return {
        ...variables,
        originClientId
    };
};
