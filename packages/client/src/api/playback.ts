import axios from 'axios';

export function getAudio(id: string) {
    return axios.request({
        method: 'GET',
        url: `/api/audio/${id}`,
        responseType: 'blob'
    });
}
