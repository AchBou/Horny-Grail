const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

export const API_BASE_URL = trimTrailingSlash(import.meta.env.PUBLIC_API_BASE_URL || '/api');

export const CLOUDFRONT_BASE_URL = trimTrailingSlash(
	import.meta.env.PUBLIC_CLOUDFRONT_BASE_URL || '/'
);

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
