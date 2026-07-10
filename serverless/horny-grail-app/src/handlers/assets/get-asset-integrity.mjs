import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getBucketName, getBucketRegion } from '../../config/env.mjs';
import { requireWriteApiKey } from '../../lib/auth.mjs';
import { badRequest, jsonResponse, serverError } from '../../lib/http.mjs';
import { getItemById } from '../../lib/items-repository.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';
import { isValidImageExt, isValidImageId } from '../../lib/validation.mjs';

const s3Client = new S3Client({ region: getBucketRegion() });

async function objectExists(key, context = {}) {
  const bucket = getBucketName();

  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: key
    }));
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

export async function buildAssetIntegrityResponse(id, event) {
  if (!isValidImageId(id)) {
    return badRequest('Invalid image id', event);
  }

  try {
    const item = await getItemById(id);

    if (!item) {
      return jsonResponse(200, {
        id,
        metadataExists: false,
        originalExists: false,
        thumbnailExists: false,
        repairRequired: false,
        missing: []
      }, event);
    }

    const ext = typeof item.ext === 'string' ? item.ext.toLowerCase() : '';
    const originalKey = isValidImageExt(ext) ? `files/${id}.${ext}` : null;
    const thumbnailKey = `thumbnails/thumbnail-${id}.jpeg`;

    const originalExists = originalKey
      ? await objectExists(originalKey, { id, assetType: 'original' })
      : false;
    const thumbnailExists = await objectExists(thumbnailKey, { id, assetType: 'thumbnail' });

    const missing = [];
    if (!originalExists) missing.push('original');
    if (!thumbnailExists) missing.push('thumbnail');

    return jsonResponse(200, {
      id,
      metadataExists: true,
      originalExists,
      thumbnailExists,
      repairRequired: missing.length > 0,
      missing,
      item
    }, event);
  } catch (error) {
    console.error('Error checking asset integrity', error);
    return serverError('Failed to check asset integrity', event);
  }
}

export const getAssetIntegrityHandler = async (event) => {
  const guardError = guardRequest(event, {
    handlerName: 'getAssetIntegrity',
    method: 'GET',
    authorize: requireWriteApiKey
  });
  if (guardError) {
    return guardError;
  }

  return buildAssetIntegrityResponse(event?.pathParameters?.id, event);
};
