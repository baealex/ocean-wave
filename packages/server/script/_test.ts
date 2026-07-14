import childProcess from 'child_process';
import {
    createDatabase,
    removeDatabase,
} from './shared';
import { testAudioMetadataWriter } from './_test-audio-metadata-writer';

const main = async () => {
    const fileName = 'test.sqlite3';

    try {
        await removeDatabase(fileName);
        await createDatabase();
        await testAudioMetadataWriter();
        childProcess.execSync('jest --coverage --runInBand', {
            stdio: 'inherit',
        });
    } catch (e) {
        console.error(e);
        process.exit(1);
    } finally {
        await removeDatabase(fileName);
    }
};

main();
