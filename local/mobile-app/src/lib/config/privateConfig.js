import { mobilePrivateConfig } from '$lib/generated/privateConfig.js';

function requireString(name, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing private mobile config value: ${name}`);
  }

  return value;
}

export const apiBaseUrl = requireString('apiBaseUrl', mobilePrivateConfig.apiBaseUrl);
export const cloudFrontBaseUrl = requireString('cloudFrontBaseUrl', mobilePrivateConfig.cloudFrontBaseUrl);
export const writeApiKey = requireString('writeApiKey', mobilePrivateConfig.writeApiKey);

export function buildApiUrl(pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${apiBaseUrl}${normalizedPath}`;
}

export function buildCloudFrontFileUrl(id, ext) {
  return `${cloudFrontBaseUrl}/files/${id}.${ext}`;
}

export function buildCloudFrontThumbnailUrl(id) {
  return `${cloudFrontBaseUrl}/thumbnails/thumbnail-${id}.jpeg`;
}
