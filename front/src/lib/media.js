import {
	USE_MOCK_GALLERY,
	buildApiUrl,
	buildFileUrl,
	buildMockFileUrl,
	buildMockThumbnailUrl,
	buildThumbnailUrl
} from '$lib/config/publicEnv.js';
import { getMockBrowsePage } from '$lib/mocks/gallery.js';
import { normalizeImages, writeTagFilter } from '$lib/models/image.js';

/** @param {{ id: string, ext?: string | null }} item */
export function fileUrlFor(item) {
	return USE_MOCK_GALLERY ? buildMockFileUrl(item.id) : buildFileUrl(item.id, item.ext || 'jpeg');
}

/** @param {{ id: string }} item */
export function thumbnailUrlFor(item) {
	return USE_MOCK_GALLERY ? buildMockThumbnailUrl(item.id) : buildThumbnailUrl(item.id);
}

/** Human-readable message for a failed gallery request. */
export function describeRequestFailure(status, fallbackMessage) {
	if (status === 404) return 'Nothing is available to show yet.';
	if (status >= 500) return 'The gallery is temporarily unavailable. Try again in a moment.';
	return fallbackMessage || 'Failed to load the gallery.';
}

function shuffled(items) {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

/**
 * One page of the shuffled feed (`GET /api/browse/random`). Without a cursor the server starts
 * a new shuffle, so this also serves Random.
 * @param {{ cursor?: string | null, limit: number, filter: { tags: string[], untagged: boolean } }} options
 * @returns {Promise<{ items: import('$lib/models/image.js').ImageItem[], cursor: string | null, hasMore: boolean }>}
 */
export async function fetchShufflePage({ cursor = null, limit, filter }) {
	let payload;
	if (USE_MOCK_GALLERY) {
		payload = getMockBrowsePage(cursor, limit, filter);
		if (!cursor) payload = { ...payload, items: shuffled(payload.items) };
	} else {
		const url = new URL(buildApiUrl('/browse/random'), window.location.origin);
		url.searchParams.set('limit', String(limit));
		if (cursor) url.searchParams.set('cursor', cursor);
		writeTagFilter(url.searchParams, filter);

		const response = await fetch(url);
		if (!response.ok) {
			const body = await response.json().catch(() => null);
			const error = new Error(
				describeRequestFailure(response.status, body?.message || `HTTP error ${response.status}`)
			);
			error.status = response.status;
			throw error;
		}
		payload = await response.json();
	}

	return {
		items: normalizeImages(payload.items),
		cursor: typeof payload.cursor === 'string' ? payload.cursor : null,
		hasMore: Boolean(payload.hasMore)
	};
}

/** Short label for a filter, e.g. "beach + sun", "Untagged" or "Everything". */
export function describeFilter(filter) {
	if (filter.untagged) return 'Untagged';
	return filter.tags.length ? filter.tags.join(' + ') : 'Everything';
}
