import type { IAudioMetadata } from 'music-metadata';

type MusicMetadataModule = typeof import('music-metadata');

const loadMusicMetadata = new Function(
    'return import("music-metadata")'
) as () => Promise<MusicMetadataModule>;

export const parseBuffer = async (data: Buffer): Promise<IAudioMetadata> => {
    const metadata = await loadMusicMetadata();

    return metadata.parseBuffer(data);
};
