const DEFAULT_LOOKUP_TABLE = 'horny-grail-name-lookup';
const DEFAULT_CLOUDFRONT_BASE_URL = 'https://dqvs0hmo3wpp7.cloudfront.net';

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

export const lookupTableName = process.env.LOOKUP_TABLE || DEFAULT_LOOKUP_TABLE;

export const cloudFrontBaseUrl = trimTrailingSlash(
  process.env.CLOUDFRONT_BASE_URL || DEFAULT_CLOUDFRONT_BASE_URL
);

export function buildCloudFrontFileUrl(key) {
  return `${cloudFrontBaseUrl}/files/${key}`;
}
