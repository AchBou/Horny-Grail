const trimTrailingSlash = (value) => value.replace(/\/+$/, '');
const requireEnv = (name, value) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

export function getLookupTableName() {
  return requireEnv('LOOKUP_TABLE', process.env.LOOKUP_TABLE);
}

export function getCloudFrontBaseUrl() {
  return trimTrailingSlash(
    requireEnv('CLOUDFRONT_BASE_URL', process.env.CLOUDFRONT_BASE_URL)
  );
}

export function getWriteApiKey() {
  return requireEnv('WRITE_API_KEY', process.env.WRITE_API_KEY);
}

export function getBucketName() {
  return requireEnv('BUCKET_NAME', process.env.BUCKET_NAME);
}

export function getBucketRegion() {
  return requireEnv('BUCKET_REGION', process.env.BUCKET_REGION);
}

export function buildCloudFrontFileUrl(key) {
  return `${getCloudFrontBaseUrl()}/files/${key}`;
}
