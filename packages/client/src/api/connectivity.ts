import axios from 'axios';
export interface ConnectivityDiagnostics { authenticated: boolean; rangeRequests: boolean; socketConnections: number; streamReadable: boolean; responsePreparationMs: number; transcodes: { active: number; maximum: number }; serverTime: string }
export const getConnectivityDiagnostics = async () => {
    const startedAt = performance.now();
    const data = (await axios.get<ConnectivityDiagnostics>('/api/diagnostics/connectivity')).data;
    return { ...data, roundTripMs: Math.round(performance.now() - startedAt) };
};
