import assert from 'node:assert/strict';
import test from 'node:test';
import { getMediaKindFromExt, normalizeImageItem, normalizeImages } from '../../src/lib/models/image.js';

const id = 'a'.repeat(64);

test('normalizes current API objects', () => {
	assert.deepEqual(normalizeImageItem({ id, ext: 'JPG', date: '2026-01-01T00:00:00Z', status: 'active' }), {
		id,
		ext: 'jpg',
		kind: 'image',
		dateAdded: '2026-01-01T00:00:00Z'
	});
	assert.equal(normalizeImageItem({ id, ext: 'mp4' }).kind, 'video');
});

test('still accepts older string payloads (bare id, filename or URL)', () => {
	assert.deepEqual(normalizeImageItem(id), { id, ext: null, kind: 'image', dateAdded: null });
	assert.deepEqual(normalizeImageItem(`https://cdn/files/${id}.webm`), { id, ext: 'webm', kind: 'video', dateAdded: null });
});

test('takes the extension from a url when ext is missing', () => {
	assert.equal(normalizeImageItem({ id, url: `/files/${id}.png` }).ext, 'png');
});

test('drops items without an id', () => {
	assert.equal(normalizeImageItem({ ext: 'jpg' }), null);
	assert.equal(normalizeImageItem(null), null);
	assert.equal(normalizeImageItem(''), null);
});

test('normalizes a list or a { data } payload and filters bad entries', () => {
	assert.equal(normalizeImages([{ id, ext: 'jpg' }, null, { ext: 'png' }]).length, 1);
	assert.equal(normalizeImages({ data: [{ id, ext: 'jpg' }] }).length, 1);
	assert.deepEqual(normalizeImages(undefined), []);
});

test('only webm and mp4 count as video', () => {
	assert.equal(getMediaKindFromExt('WEBM'), 'video');
	assert.equal(getMediaKindFromExt('gif'), 'image');
	assert.equal(getMediaKindFromExt(null), 'image');
});
