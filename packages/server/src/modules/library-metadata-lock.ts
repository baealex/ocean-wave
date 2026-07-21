let libraryMetadataQueue: Promise<void> = Promise.resolve();

export const withLibraryMetadataLock = async <T>(operation: () => Promise<T>) => {
    const previous = libraryMetadataQueue;
    let release!: () => void;
    libraryMetadataQueue = new Promise<void>((resolve) => {
        release = resolve;
    });
    await previous;

    try {
        return await operation();
    } finally {
        release();
    }
};
