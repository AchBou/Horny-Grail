const trimTrailingSlash = (value) => value.replace(/\/+$/, '');
const requireEnv = (name, value) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

export const lookupTableName = requireEnv('LOOKUP_TABLE', process.env.LOOKUP_TABLE);

export const cloudFrontBaseUrl = trimTrailingSlash(
  requireEnv('CLOUDFRONT_BASE_URL', process.env.CLOUDFRONT_BASE_URL)
);

export function getWriteApiKey() {
  return requireEnv('WRITE_API_KEY', process.env.WRITE_API_KEY);
}

export function buildCloudFrontFileUrl(key) {
  return `${cloudFrontBaseUrl}/files/${key}`;
}
