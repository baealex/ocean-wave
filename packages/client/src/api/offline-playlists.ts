import axios from 'axios';
export const getPlaylistOfflineAssets = async (id: string) => (await axios.get<{ playlistId: number; totalBytes: number; urls: string[] }>(`/api/playlists/${id}/offline-assets`)).data;
