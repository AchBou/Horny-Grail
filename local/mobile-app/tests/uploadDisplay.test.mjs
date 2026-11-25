import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANCELLABLE_STATUSES,
  canCancel,
  detailUrlForUpload,
  formatFileSize,
  isVideoUpload,
  statusText,
  uploadProgress
} from '../src/lib/mobile/uploadDisplay.js';

test('labels known statuses and passes unknown ones through', () => {
  assert.equal(statusText({ status: 'duplicate' }), 'Already saved');
  assert.equal(statusText({ status: 'failed' }), 'Needs attention');
  assert.equal(statusText({ status: 'mystery' }), 'mystery');
  assert.equal(statusText({}), 'Pending');
});

test('progress only moves forward through the upload steps and ends at 100', () => {
  const order = ['preparing', 'queued', 'hashing', 'checking', 'uploading-original', 'thumbnailing', 'uploading-thumbnail', 'registering', 'complete'];
  const values = order.map((status) => uploadProgress({ status }));

  assert.deepEqual([...values].sort((a, b) => a - b), values);
  assert.equal(values.at(-1), 100);
  for (const done of ['duplicate', 'failed', 'cancelled']) assert.equal(uploadProgress({ status: done }), 100);
  assert.equal(uploadProgress({ status: 'unknown' }), 0);
});

test('only in-flight items can be cancelled', () => {
  assert.equal(canCancel({ status: 'uploading-original' }), true);
  assert.equal(canCancel({ status: 'registering' }), true);
  for (const status of ['complete', 'duplicate', 'failed', 'cancelled']) {
    assert.equal(canCancel({ status }), false, status);
    assert.equal(CANCELLABLE_STATUSES.has(status), false, status);
  }
});

test('formats file sizes for the queue', () => {
  assert.equal(formatFileSize(0), 'Unknown size');
  assert.equal(formatFileSize(NaN), 'Unknown size');
  assert.equal(formatFileSize(900), '900 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(18 * 1024 * 1024), '18 MB');
  assert.equal(formatFileSize(3 * 1024 ** 4), '3072 GB');
});

test('detects videos by MIME type or extension', () => {
  assert.equal(isVideoUpload({ file: { type: 'video/mp4' }, name: 'a.bin' }), true);
  assert.equal(isVideoUpload({ file: { type: '' }, name: 'clip.WEBM' }), true);
  assert.equal(isVideoUpload({ file: { type: 'image/png' }, name: 'a.png' }), false);
});

test('links saved items to their detail page', () => {
  assert.equal(detailUrlForUpload({ id: 'abc' }), '/image/abc');
  assert.equal(detailUrlForUpload({ id: null }), '');
});
