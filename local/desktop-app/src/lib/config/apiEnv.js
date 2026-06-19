const env = import.meta.env;

/**
 * @param {string} name
 * @param {string | undefined} value
 * @returns {string}
 */
const requireEnv = (name, value) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

/**
 * @param {string} value
 * @returns {string}
 */
const trimTrailingSlash = (value) => value.replace(/\/+$/, "");

export const API_BASE_URL = trimTrailingSlash(
  requireEnv("VITE_API_BASE_URL", env.VITE_API_BASE_URL)
);

export const WRITE_API_KEY = requireEnv("VITE_WRITE_API_KEY", env.VITE_WRITE_API_KEY);

export function buildApiUrl(path = "") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
