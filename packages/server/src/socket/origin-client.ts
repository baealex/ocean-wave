export interface OriginClientNotificationPayload {
    originClientId?: string | null;
}

export const withOriginClientId = <TPayload extends object>(
    payload: TPayload,
    originClientId?: string | null
): TPayload & { originClientId?: string } => {
    if (!originClientId) {
        return payload;
    }

    return {
        ...payload,
        originClientId
    };
};
