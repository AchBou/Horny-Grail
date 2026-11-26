import assert from 'node:assert/strict';
import test from 'node:test';
import { createUploadFlow } from '../src/lib/mobile/uploadFlowCore.js';
import { isDeletableFromPhone } from '../src/lib/mobile/uploadDisplay.js';

const ID = 'a'.repeat(64);

/**
 * A fake Grail that answers like the real routes: integrity reports what is stored, signed
 * uploads store a part, and registering needs both files (the real route answers 409).
 */
function createFakeGrail({ metadata = false, original = false, thumbnail = false } = {}) {
  const stored = { metadata, original, thumbnail };
  const calls = [];
  // Per part: how many uploads fail with an error, and whether uploads "succeed" but store nothing.
  const failures = { original: 0, thumbnail: 0 };
  const silentlyLost = { original: false, thumbnail: false };

  const integrity = () => {
    const missing = [];
    if (!stored.original) missing.push('original');
    if (!stored.thumbnail) missing.push('thumbnail');
    return {
      id: ID,
      metadataExists: stored.metadata,
      originalExists: stored.original,
      thumbnailExists: stored.thumbnail,
      repairRequired: stored.metadata && missing.length > 0,
      missing
    };
  };

  const deps = {
    THUMBNAIL_EXT: 'jpeg',
    THUMBNAIL_MIME_TYPE: 'image/jpeg',
    getExtensionFromFile: (file) => file.name.split('.').pop().toLowerCase(),
    getMimeTypeFromExtension: (ext) => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', webm: 'video/webm' })[ext] || null,
    hashFile: async () => {
      calls.push('hash');
      return ID;
    },
    createThumbnail: async () => {
      calls.push('thumbnail-made');
      return new Blob(['thumb'], { type: 'image/jpeg' });
    },
    fetchAssetIntegrity: async () => {
      calls.push('integrity');
      return integrity();
    },
    signUpload: async ({ path }) => {
      calls.push(`sign:${path}`);
      return { uploadUrl: path, headers: {} };
    },
    putBinary: async (url) => {
      const part = url === 'files' ? 'original' : 'thumbnail';
      calls.push(`put:${part}`);
      if (failures[part] > 0) {
        failures[part] -= 1;
        throw new Error('network dropped');
      }
      if (!silentlyLost[part]) stored[part] = true;
    },
    registerMetadata: async () => {
      calls.push('register');
      if (!stored.original || !stored.thumbnail) {
        throw Object.assign(new Error('Upload the original and thumbnail first'), { status: 409 });
      }
      stored.metadata = true;
    }
  };

  return { stored, calls, failures, silentlyLost, runUploadFlow: createUploadFlow(deps) };
}

const photo = () => new File(['bytes'], 'beach.jpg', { type: 'image/jpeg' });
const uploads = (calls) => calls.filter((call) => call.startsWith('put:') || call === 'register');

test('a file the Grail already has completely is a duplicate: nothing is uploaded again', async () => {
  const grail = createFakeGrail({ metadata: true, original: true, thumbnail: true });

  const result = await grail.runUploadFlow(photo());

  assert.equal(result.outcome, 'duplicate');
  assert.deepEqual(uploads(grail.calls), []);
});

test('a new file uploads the original, then the cover, then registers', async () => {
  const grail = createFakeGrail();
  const phases = [];

  const result = await grail.runUploadFlow(photo(), (phase) => phases.push(phase));

  assert.equal(result.outcome, 'uploaded');
  assert.deepEqual(uploads(grail.calls), ['put:original', 'put:thumbnail', 'register']);
  assert.deepEqual(grail.stored, { metadata: true, original: true, thumbnail: true });
  assert.equal(phases.at(-1), 'complete');
});

test('an item missing only its cover gets only the cover (repair), and is not registered twice', async () => {
  const grail = createFakeGrail({ metadata: true, original: true });

  const result = await grail.runUploadFlow(photo());

  assert.equal(result.outcome, 'repaired');
  assert.deepEqual(uploads(grail.calls), ['put:thumbnail']);
});

test('an item missing only its original gets only the original (repair)', async () => {
  const grail = createFakeGrail({ metadata: true, thumbnail: true });

  const result = await grail.runUploadFlow(photo());

  assert.equal(result.outcome, 'repaired');
  assert.deepEqual(uploads(grail.calls), ['put:original']);
  assert.ok(!grail.calls.includes('thumbnail-made'));
});

test('files uploaded before an interruption are not uploaded again', async () => {
  const grail = createFakeGrail({ original: true });

  const result = await grail.runUploadFlow(photo());

  assert.equal(result.outcome, 'uploaded');
  assert.deepEqual(uploads(grail.calls), ['put:thumbnail', 'register']);
});

test('a dropped upload is retried and then succeeds', async () => {
  const grail = createFakeGrail();
  grail.failures.original = 2;

  const result = await grail.runUploadFlow(photo());

  assert.equal(result.outcome, 'uploaded');
  assert.equal(uploads(grail.calls).filter((call) => call === 'put:original').length, 3);
});

test('an upload that keeps failing stops with an error and never reports the file as saved', async () => {
  const grail = createFakeGrail();
  grail.failures.original = 3;
  const phases = [];

  await assert.rejects(grail.runUploadFlow(photo(), (phase) => phases.push(phase)), /Original upload failed/);
  assert.ok(!phases.includes('complete'));
  assert.ok(!grail.calls.includes('register'));
});

test('if the server does not end up with the file, the upload fails even though every request "worked"', async () => {
  const grail = createFakeGrail();
  grail.silentlyLost.thumbnail = true;
  const phases = [];

  await assert.rejects(grail.runUploadFlow(photo(), (phase) => phases.push(phase)));
  assert.ok(!phases.includes('complete'));
  assert.equal(grail.stored.metadata, false);
});

test('a cancelled upload stops before touching the Grail', async () => {
  const grail = createFakeGrail();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(grail.runUploadFlow(photo(), null, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(grail.calls, []);
});

test('only saved or already-saved files that are still on the phone can be deleted from it', () => {
  const saved = { id: ID, sourceUri: 'content://media/1', status: 'complete' };

  assert.equal(isDeletableFromPhone(saved), true);
  assert.equal(isDeletableFromPhone({ ...saved, status: 'duplicate' }), true);
  for (const status of ['queued', 'hashing', 'checking', 'uploading-original', 'uploading-thumbnail', 'registering', 'failed', 'cancelled']) {
    assert.equal(isDeletableFromPhone({ ...saved, status }), false, status);
  }
  assert.equal(isDeletableFromPhone({ ...saved, sourceUri: null }), false, 'already deleted');
  assert.equal(isDeletableFromPhone({ ...saved, id: null }), false, 'no confirmed id');
});
