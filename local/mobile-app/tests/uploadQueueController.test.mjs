import assert from 'node:assert/strict';
import test from 'node:test';
import { createUploadQueueProcessor } from '../src/lib/mobile/uploadQueueController.js';

function createHarness(runFlow) {
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
    isAbortError: (error) => error?.name === 'AbortError'
  });
  return { items, updates, processor };
}

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
