import { mobilePrivateConfig } from '$lib/generated/privateConfig.js';

function requireString(name, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing private mobile config value: ${name}`);
  }

  return value;
}

export const apiBaseUrl = requireString('apiBaseUrl', mobilePrivateConfig.apiBaseUrl);
const apiOriginBaseUrl = apiBaseUrl.replace(/\/api$/, '');

export function buildApiUrl(pathname = '') {
  if (pathname === '' || pathname === '/') {
    return apiBaseUrl;
  }

  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${apiBaseUrl}${normalizedPath}`;
}

export function buildServiceUrl(pathname = '') {
  if (pathname === '' || pathname === '/') {
    return apiOriginBaseUrl;
  }

  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${apiOriginBaseUrl}${normalizedPath}`;
}
