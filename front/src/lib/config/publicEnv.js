import { env } from '$env/dynamic/public';

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

export const API_BASE_URL = trimTrailingSlash(env.PUBLIC_API_BASE_URL || '/api');

export const CLOUDFRONT_BASE_URL = trimTrailingSlash(env.PUBLIC_CLOUDFRONT_BASE_URL || '/');

export const USE_MOCK_GALLERY = env.PUBLIC_USE_MOCK_GALLERY === 'true';

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
