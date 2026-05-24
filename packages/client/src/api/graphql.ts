import axios from 'axios';

type QueryName = 'query' | 'mutation';

type Properties<T> = (keyof T)[] | string[];

type GraphqlVariables = Record<string, unknown>;

interface GraphqlResponse<T extends string, K> {
    data: {
        [key in T]: K;
    };
}

interface GraphqlRequestOptions<TVariables extends GraphqlVariables = GraphqlVariables> {
    query: string;
    variables?: TVariables;
    operationName?: string;
}

export function wrapper(queryName: QueryName | string, query: string): string {
    return queryName + ' { ' + query + ' }';
}

export function createQuery<T>(itemName: string, itemProperties: Properties<T>): string {
    return itemName + ' {' + itemProperties.join(' ') + '}';
}

export async function graphQLRequest<T extends string, K, TVariables extends GraphqlVariables = GraphqlVariables>({
    query,
    variables,
    operationName
}: GraphqlRequestOptions<TVariables>): Promise<GraphqlResponse<T, K>> {
    const { data } = await axios.request<GraphqlResponse<T, K>>({
        url: '/graphql',
        method: 'POST',
        data: { query, variables, operationName }
    });
    return data;
}
