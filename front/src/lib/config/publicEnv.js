import { env } from "$env/dynamic/public";

const trimTrailingSlash = (value) => value.replace(/\/+$/, "");
const requirePublicEnv = (name, value) => {
  if (!value) {
    throw new Error(`Missing required public environment variable: ${name}`);
  }

  return value;
};

export const API_BASE_URL = trimTrailingSlash(
  requirePublicEnv("PUBLIC_API_BASE_URL", env.PUBLIC_API_BASE_URL)
);

export const CLOUDFRONT_BASE_URL = trimTrailingSlash(
  requirePublicEnv("PUBLIC_CLOUDFRONT_BASE_URL", env.PUBLIC_CLOUDFRONT_BASE_URL)
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
