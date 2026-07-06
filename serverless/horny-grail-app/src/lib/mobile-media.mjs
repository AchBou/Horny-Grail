import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  getBucketName,
  getBucketRegion,
  getMobileSignedUrlTtlSeconds
} from '../config/env.mjs';
import { isValidImageExt, normalizeImageExt } from './validation.mjs';

const s3Client = new S3Client({ region: getBucketRegion() });

function requireItemId(item) {
  if (typeof item?.id !== 'string' || item.id.length === 0) {
    throw new Error('Missing item id');
  }

  return item.id;
}

function requireItemExt(item) {
  const ext = normalizeImageExt(item?.ext);
  if (!isValidImageExt(ext)) {
    throw new Error('Missing or invalid item extension');
  }

  return ext;
}

async function signObjectUrl(key, expiresIn) {
  return getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key
  }), { expiresIn });
}

export async function createSignedMediaView(item) {
  const id = requireItemId(item);
  const ext = requireItemExt(item);
  const expiresIn = getMobileSignedUrlTtlSeconds();

  const [fileUrl, thumbnailUrl] = await Promise.all([
    signObjectUrl(`files/${id}.${ext}`, expiresIn),
    signObjectUrl(`thumbnails/thumbnail-${id}.jpeg`, expiresIn)
  ]);

  return {
    ...item,
    id,
    ext,
    fileUrl,
    thumbnailUrl
  };
}
