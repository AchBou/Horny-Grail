import assert from 'node:assert/strict';
import test from 'node:test';
import { getMediaKindFromExt, normalizeImageItem, normalizeImages, readTagFilter, writeTagFilter } from '../../src/lib/models/image.js';

const id = 'a'.repeat(64);

test('normalizes current API objects', () => {
	assert.deepEqual(normalizeImageItem({ id, ext: 'JPG', date: '2026-01-01T00:00:00Z', status: 'active' }), {
		id,
		ext: 'jpg',
		kind: 'image',
		dateAdded: '2026-01-01T00:00:00Z',
		tags: []
	});
	assert.equal(normalizeImageItem({ id, ext: 'mp4' }).kind, 'video');
});

test('still accepts older string payloads (bare id, filename or URL)', () => {
	assert.deepEqual(normalizeImageItem(id), { id, ext: null, kind: 'image', dateAdded: null, tags: [] });
	assert.deepEqual(normalizeImageItem(`https://cdn/files/${id}.webm`), { id, ext: 'webm', kind: 'video', dateAdded: null, tags: [] });
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

test('keeps text tags from the API and drops anything else', () => {
	assert.deepEqual(normalizeImageItem({ id, ext: 'jpg', tags: ['beach', 3, '', 'sun'] }).tags, ['beach', 'sun']);
	assert.deepEqual(normalizeImageItem({ id, ext: 'jpg', tags: 'beach' }).tags, []);
});

test('reads the tag filter from the page URL', () => {
	assert.deepEqual(readTagFilter(new URLSearchParams('tags=Beach, sun,beach')), { tags: ['beach', 'sun'], untagged: false });
	assert.deepEqual(readTagFilter(new URLSearchParams('untagged=1&tags=beach')), { tags: [], untagged: true });
	assert.deepEqual(readTagFilter(new URLSearchParams('')), { tags: [], untagged: false });
});

test('writes the tag filter into query parameters and clears it when empty', () => {
	const params = new URLSearchParams('limit=24&untagged=1');
	writeTagFilter(params, { tags: ['beach', 'sun'], untagged: false });
	assert.equal(params.toString(), 'limit=24&tags=beach%2Csun');

	writeTagFilter(params, { tags: [], untagged: false });
	assert.equal(params.toString(), 'limit=24');
});
