import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMediaViews } from '../src/lib/mobile/items.js';

const id = 'a'.repeat(64);

test('turns browse items into views with signed URLs and a detail link', () => {
  const [view] = normalizeMediaViews({
    items: [{ id, ext: 'WEBM', fileUrl: 'https://s3/file', thumbnailUrl: 'https://s3/thumb', date: '2026-01-01' }]
  });

  assert.equal(view.id, id);
  assert.equal(view.ext, 'webm');
  assert.equal(view.kind, 'video');
  assert.equal(view.fileUrl, 'https://s3/file');
  assert.equal(view.thumbnailUrl, 'https://s3/thumb');
  assert.equal(view.detailUrl, `/image/${id}`);
});

test('drops items the app cannot display', () => {
  const views = normalizeMediaViews([
    { id, ext: 'jpg', fileUrl: 'f' },                       // no thumbnail URL
    { id, fileUrl: 'f', thumbnailUrl: 't' },                // no extension
    { ext: 'jpg', fileUrl: 'f', thumbnailUrl: 't' },        // no id
    null,
    { id, ext: 'png', fileUrl: 'f', thumbnailUrl: 't' }
  ]);

  assert.equal(views.length, 1);
  assert.equal(views[0].ext, 'png');
  assert.equal(views[0].kind, 'image');
});

test('accepts an array, an items payload, or nothing', () => {
  const item = { id, ext: 'jpg', fileUrl: 'f', thumbnailUrl: 't' };

  assert.equal(normalizeMediaViews([item]).length, 1);
  assert.equal(normalizeMediaViews({ data: [item] }).length, 1);
  assert.deepEqual(normalizeMediaViews(null), []);
});
