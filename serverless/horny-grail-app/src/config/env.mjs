const requireEnv = (name, value) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

export function getLookupTableName() {
  return requireEnv('LOOKUP_TABLE', process.env.LOOKUP_TABLE);
}

export function getWriteApiKey() {
  return requireEnv('WRITE_API_KEY', process.env.WRITE_API_KEY);
}

export function getReadAccessCode() {
  return requireEnv('READ_ACCESS_CODE', process.env.READ_ACCESS_CODE);
}

export function getReadOriginSecret() {
  return requireEnv('READ_ORIGIN_SECRET', process.env.READ_ORIGIN_SECRET);
}

export function getMobileReadTokenSecret() {
  return requireEnv('MOBILE_READ_TOKEN_SECRET', process.env.MOBILE_READ_TOKEN_SECRET);
}

export function getMobileReadTokenTtlSeconds() {
  const value = Number.parseInt(
    requireEnv('MOBILE_READ_TOKEN_TTL_SECONDS', process.env.MOBILE_READ_TOKEN_TTL_SECONDS),
    10
  );

  if (!Number.isInteger(value) || value < 60) {
    throw new Error('MOBILE_READ_TOKEN_TTL_SECONDS must be an integer of at least 60');
  }

  return value;
}

export function getMobileSignedUrlTtlSeconds() {
  const value = Number.parseInt(
    requireEnv('MOBILE_SIGNED_URL_TTL_SECONDS', process.env.MOBILE_SIGNED_URL_TTL_SECONDS),
    10
  );

  if (!Number.isInteger(value) || value < 60) {
    throw new Error('MOBILE_SIGNED_URL_TTL_SECONDS must be an integer of at least 60');
  }

  return value;
}

export function getBucketName() {
  return requireEnv('BUCKET_NAME', process.env.BUCKET_NAME);
}

export function getBucketRegion() {
  return requireEnv('BUCKET_REGION', process.env.BUCKET_REGION);
}
