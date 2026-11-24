import assert from 'node:assert/strict';
import test from 'node:test';
import { PAUSED_MESSAGE, createUploadQueueProcessor } from '../src/lib/mobile/uploadQueueController.js';

function createHarness(runFlow, { unlocked = { value: true } } = {}) {
  const items = [{ localId: 'one', file: { name: 'one.jpg' }, status: 'queued', controller: new AbortController() }];
  const updates = [];
  const processor = createUploadQueueProcessor({
    getItems: () => items,
    getItem: (localId) => items.find((item) => item.localId === localId),
    updateItem: (localId, patch) => {
      const item = items.find((entry) => entry.localId === localId);
      Object.assign(item, patch);
      updates.push({ localId, patch });
    },
    runFlow,
    resolveThumbnail: async () => 'thumb-url',
    outcomeText: (outcome) => outcome,
    isAbortError: (error) => error?.name === 'AbortError',
    isUnauthorizedError: (error) => error?.status === 401,
    canProcess: () => unlocked.value
  });
  return { items, updates, processor };
}

test('does not start uploads while the vault is locked', async () => {
  let calls = 0;
  const harness = createHarness(async () => {
    calls += 1;
    return { id: 'hash', ext: 'jpg', outcome: 'uploaded', integrity: {} };
  }, { unlocked: { value: false } });

  await harness.processor.process();

  assert.equal(calls, 0);
  assert.equal(harness.items[0].status, 'queued');
});

test('puts an upload back in line when the session ends, then resumes after unlock', async () => {
  const unlocked = { value: true };
  let calls = 0;
  const harness = createHarness(async () => {
    calls += 1;
    if (calls === 1) {
      unlocked.value = false;
      const error = new Error('Enter the access code to continue');
      error.status = 401;
      throw error;
    }
    return { id: 'hash', ext: 'jpg', outcome: 'uploaded', integrity: {} };
  }, { unlocked });

  await harness.processor.process();
  assert.equal(harness.items[0].status, 'queued');
  assert.equal(harness.items[0].message, PAUSED_MESSAGE);
  assert.equal(harness.items[0].error, null);

  unlocked.value = true;
  await harness.processor.process();
  assert.equal(harness.items[0].status, 'complete');
  assert.equal(calls, 2);
});

test('completes a queued upload and records its result', async () => {
  const harness = createHarness(async (_file, progress) => {
    progress('uploading-original', { id: 'hash' });
    return { id: 'hash', ext: 'jpg', outcome: 'uploaded', integrity: { metadataExists: true } };
  });

  await harness.processor.process();

  assert.equal(harness.items[0].status, 'complete');
  assert.equal(harness.items[0].id, 'hash');
  assert.equal(harness.items[0].thumbnailUrl, 'thumb-url');
});

test('marks a failed upload without stopping the queue processor', async () => {
  const harness = createHarness(async () => {
    throw new Error('network unavailable');
  });

  await harness.processor.process();

  assert.equal(harness.items[0].status, 'failed');
  assert.equal(harness.items[0].error, 'network unavailable');
});

test('marks an aborted upload as cancelled', async () => {
  const harness = createHarness(async () => {
    const error = new Error('cancelled');
    error.name = 'AbortError';
    throw error;
  });

  await harness.processor.process();

  assert.equal(harness.items[0].status, 'cancelled');
  assert.equal(harness.items[0].message, 'Cancelled');
});
