import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const testFiles = new Set<string>();

export const createReadableAudioTestFile = () => {
    const filePath = path.join(
        os.tmpdir(),
        `ocean-wave-playback-${process.pid}-${randomUUID()}.mp3`
    );
    fs.writeFileSync(filePath, 'playable test fixture');
    testFiles.add(filePath);
    return filePath;
};

export const removeReadableAudioTestFiles = () => {
    for (const filePath of testFiles) {
        fs.rmSync(filePath, { force: true });
    }
    testFiles.clear();
};
