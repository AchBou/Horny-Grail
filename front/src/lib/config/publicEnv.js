import {
	PUBLIC_API_BASE_URL,
	PUBLIC_CLOUDFRONT_BASE_URL,
	PUBLIC_USE_MOCK_GALLERY
} from '$env/static/public';

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

export const API_BASE_URL = trimTrailingSlash(PUBLIC_API_BASE_URL || '/api');

export const CLOUDFRONT_BASE_URL = trimTrailingSlash(PUBLIC_CLOUDFRONT_BASE_URL || '/');

export const USE_MOCK_GALLERY = PUBLIC_USE_MOCK_GALLERY === 'true';

export function buildApiUrl(path = '') {
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	return `${API_BASE_URL}${normalizedPath}`;
}

export function buildFileUrl(hash, ext) {
	return `${CLOUDFRONT_BASE_URL}/files/${hash}.${ext}`;
}

export function buildThumbnailUrl(hash) {
	return `${CLOUDFRONT_BASE_URL}/thumbnails/thumbnail-${hash}.jpeg`;
}

export function buildMockFileUrl(id) {
	return `/mock-gallery/files/${id}.svg`;
}

export function buildMockThumbnailUrl(id) {
	return `/mock-gallery/thumbnails/thumbnail-${id}.svg`;
}
