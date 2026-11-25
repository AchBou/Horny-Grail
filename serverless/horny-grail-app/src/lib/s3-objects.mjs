import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getBucketName, getBucketRegion } from '../config/env.mjs';

let s3Client;

function getS3Client() {
  s3Client ||= new S3Client({ region: getBucketRegion() });
  return s3Client;
}

export function originalObjectKey(id, ext) {
  return `files/${id}.${ext.toLowerCase()}`;
}

export function thumbnailObjectKey(id) {
  return `thumbnails/thumbnail-${id}.jpeg`;
}

/** True if the object exists, false on 404. Needs s3:GetObject on the key and s3:ListBucket on the bucket. */
export async function objectExists(key, context = {}) {
  const bucket = getBucketName();

  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const statusCode = error?.$metadata?.httpStatusCode;
    const code = error?.name || error?.Code;
    if (statusCode === 404 || code === 'NotFound' || code === 'NoSuchKey') {
      return false;
    }
    console.error('S3 asset existence check failed', {
      ...context,
      bucket,
      key,
      statusCode,
      code,
      requestId: error?.$metadata?.requestId,
      extendedRequestId: error?.$metadata?.extendedRequestId
    });
    throw error;
  }
}

/**
 * Lists which of an item's objects ('original', 'thumbnail') are missing from S3.
 * Pass ext as null when it is unknown or invalid: the original then counts as missing.
 */
export async function findMissingAssets(id, ext) {
  const [originalExists, thumbnailExists] = await Promise.all([
    ext ? objectExists(originalObjectKey(id, ext), { id, assetType: 'original' }) : false,
    objectExists(thumbnailObjectKey(id), { id, assetType: 'thumbnail' })
  ]);

  const missing = [];
  if (!originalExists) missing.push('original');
  if (!thumbnailExists) missing.push('thumbnail');
  return missing;
}
