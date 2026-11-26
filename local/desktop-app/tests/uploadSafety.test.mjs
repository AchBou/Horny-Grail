import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyIntegrity, confirmStoredFiles, isSafelyStored } from '../src/lib/functions/uploadSafety.js';

const complete = { id: 'a', metadataExists: true, originalExists: true, thumbnailExists: true, repairRequired: false, missing: [] };

test('a file counts as safely stored only when the item and both of its files are in the Grail', () => {
  assert.equal(isSafelyStored(complete), true);
  assert.equal(isSafelyStored({ ...complete, metadataExists: false }), false, 'not registered (or deleted)');
  assert.equal(isSafelyStored({ ...complete, originalExists: false, repairRequired: true }), false, 'original missing');
  assert.equal(isSafelyStored({ ...complete, thumbnailExists: false, repairRequired: true }), false, 'cover missing');
  assert.equal(isSafelyStored({ ...complete, repairRequired: true }), false, 'server asks for a repair');
  assert.equal(isSafelyStored(null), false, 'the check failed');
});

test('scan: a new, a complete, a broken and a deleted item', () => {
  assert.deepEqual(classifyIntegrity({ metadataExists: false, missing: ['original', 'thumbnail'] }), {
    exists: false, repairNeeded: false, missing: ['original', 'thumbnail'], tags: []
  });
  assert.deepEqual(classifyIntegrity({ ...complete, item: { id: 'a', ext: 'jpg', tags: ['beach'] } }), {
    exists: true, repairNeeded: false, missing: [], tags: ['beach']
  });
  assert.deepEqual(classifyIntegrity({ ...complete, thumbnailExists: false, repairRequired: true, missing: ['thumbnail'] }), {
    exists: true, repairNeeded: true, missing: ['thumbnail'], tags: []
  });
  // The server reports an item deleted from the Grail as absent: the file shows as new.
  assert.equal(classifyIntegrity({ metadataExists: false, repairRequired: false, missing: [] }).exists, false);
});

test('only files the server confirms right now may leave the PC; anything else is kept', async () => {
  const answers = {
    good: complete,
    broken: { ...complete, thumbnailExists: false, repairRequired: true },
    gone: { ...complete, metadataExists: false },
    offline: null
  };
  const asked = [];
  const files = Object.keys(answers).map((hash) => ({ path: `C:\\Sync\\${hash}.jpg`, name: `${hash}.jpg`, hash }));

  const { confirmed, errors } = await confirmStoredFiles(files, async (hash) => {
    asked.push(hash);
    return answers[hash];
  });

  assert.deepEqual(confirmed.map((file) => file.hash), ['good']);
  assert.equal(errors.length, 3);
  assert.ok(errors.every((error) => error.endsWith('kept on this PC')));
  assert.deepEqual(asked, ['good', 'broken', 'gone', 'offline'], 'every file is checked, none skipped');
});

test('a file without a hash is never confirmed', async () => {
  const { confirmed } = await confirmStoredFiles([{ path: 'x', name: 'x.jpg', hash: '' }], async () => complete);

  assert.deepEqual(confirmed, []);
});
