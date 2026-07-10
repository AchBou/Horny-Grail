import { getMediaKindFromExt } from '$lib/models/image.js';

export const mockGalleryItems = [
	{ id: 'mock-01', ext: 'svg' },
	{ id: 'mock-02', ext: 'svg' },
	{ id: 'mock-03', ext: 'svg' },
	{ id: 'mock-04', ext: 'svg' },
	{ id: 'mock-05', ext: 'svg' },
	{ id: 'mock-06', ext: 'svg' }
].map((item, index) => ({
	...item,
	kind: getMediaKindFromExt(item.ext),
	dateAdded: `2026-01-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`
}));

function parseCursor(cursor) {
	if (typeof cursor !== 'string' || cursor.length === 0) {
		return 0;
	}

	const value = Number.parseInt(cursor, 10);
	return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function getMockBrowsePage(cursor, limit) {
	const start = parseCursor(cursor);
	const pageSize = Number.isInteger(limit) && limit > 0 ? limit : mockGalleryItems.length;
	const items = mockGalleryItems.slice(start, start + pageSize);
	const nextOffset = start + items.length;

	return {
		items,
		cursor: nextOffset < mockGalleryItems.length ? String(nextOffset) : null,
		hasMore: nextOffset < mockGalleryItems.length,
		seed: 0.5,
		wrapped: false
	};
}

export function getMockRandomItem() {
	const randomIndex = Math.floor(Math.random() * mockGalleryItems.length);
	return mockGalleryItems[randomIndex] || null;
}

export function getMockItemById(id) {
	return mockGalleryItems.find((item) => item.id === id) || null;
}
