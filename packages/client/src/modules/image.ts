const RESIZED_SEGMENT = '/resized';
export const DEFAULT_ALBUM_ART = '/default-artwork.jpg';

export const getImage = (src?: string) => {
    return src || DEFAULT_ALBUM_ART;
};

export const getOriginalImage = (src?: string) => {
    return getImage(src).replace(RESIZED_SEGMENT, '');
};
