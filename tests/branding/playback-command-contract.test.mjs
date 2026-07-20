import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const serverContract = new URL(
    '../../packages/server/src/socket/playback-command-contract.ts',
    import.meta.url
);
const clientContract = new URL(
    '../../packages/client/src/socket/playback-command-contract.ts',
    import.meta.url
);

test('server and client playback command contracts stay byte-identical', async () => {
    const [serverSource, clientSource] = await Promise.all([
        readFile(serverContract, 'utf8'),
        readFile(clientContract, 'utf8')
    ]);

    assert.equal(clientSource, serverSource);
});
