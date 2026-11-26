import { getMediaKindFromExt } from '$lib/models/image.js';

export const mockGalleryItems = [
	{ id: 'mock-01', ext: 'svg', tags: ['beach', 'sun'] },
	{ id: 'mock-02', ext: 'svg', tags: ['beach'] },
	{ id: 'mock-03', ext: 'svg', tags: ['night'] },
	{ id: 'mock-04', ext: 'svg' },
	{ id: 'mock-05', ext: 'svg' },
	{ id: 'mock-06', ext: 'svg', tags: ['sun'] }
].map((item, index) => ({
	tags: [],
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

function matchesFilter(item, filter) {
	if (!filter) return true;
	if (filter.untagged) return item.tags.length === 0;
	return filter.tags.every((tag) => item.tags.includes(tag));
}

export function getMockBrowsePage(cursor, limit, filter = null) {
	const source = mockGalleryItems.filter((item) => matchesFilter(item, filter));
	const start = parseCursor(cursor);
	const pageSize = Number.isInteger(limit) && limit > 0 ? limit : source.length;
	const items = source.slice(start, start + pageSize);
	const nextOffset = start + items.length;

	return {
		items,
		cursor: nextOffset < source.length ? String(nextOffset) : null,
		hasMore: nextOffset < source.length,
		seed: '0000000000000000'
	};
}

/** Same shape as GET /api/tags. */
export function getMockTagSummary() {
	const counts = new Map();
	for (const item of mockGalleryItems) {
		for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
	}
	return {
		tags: [...counts]
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
		total: mockGalleryItems.length,
		untagged: mockGalleryItems.filter((item) => item.tags.length === 0).length
	};
}

export function getMockRandomItem() {
	const randomIndex = Math.floor(Math.random() * mockGalleryItems.length);
	return mockGalleryItems[randomIndex] || null;
}

export function getMockItemById(id) {
	return mockGalleryItems.find((item) => item.id === id) || null;
}
