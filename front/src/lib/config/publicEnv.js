import { env } from "$env/dynamic/public";

const trimTrailingSlash = (value) => value.replace(/\/+$/, "");

export const API_BASE_URL = trimTrailingSlash(
  env.PUBLIC_API_BASE_URL || "https://9k82wh6773.execute-api.us-east-1.amazonaws.com/api"
);

export const CLOUDFRONT_BASE_URL = trimTrailingSlash(
  env.PUBLIC_CLOUDFRONT_BASE_URL || "https://dqvs0hmo3wpp7.cloudfront.net"
);

export function buildApiUrl(path = "") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function buildFileUrl(hash, ext) {
  return `${CLOUDFRONT_BASE_URL}/files/${hash}.${ext}`;
}

export function buildThumbnailUrl(hash) {
  return `${CLOUDFRONT_BASE_URL}/thumbnails/thumbnail-${hash}.jpeg`;
}
