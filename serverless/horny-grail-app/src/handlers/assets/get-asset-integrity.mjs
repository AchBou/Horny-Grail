import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getBucketName, getBucketRegion } from '../../config/env.mjs';
import { requireWriteApiKey } from '../../lib/auth.mjs';
import { badRequest, jsonResponse, methodNotAllowed, serverError } from '../../lib/http.mjs';
import { getItemById } from '../../lib/items-repository.mjs';
import { isValidImageExt, isValidImageId } from '../../lib/validation.mjs';

const s3Client = new S3Client({ region: getBucketRegion() });

async function objectExists(key) {
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: getBucketName(),
      Key: key
    }));
    return true;
  } catch (error) {
    const statusCode = error?.$metadata?.httpStatusCode;
    const code = error?.name || error?.Code;
    if (statusCode === 404 || code === 'NotFound' || code === 'NoSuchKey') {
      return false;
    }
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

    const originalExists = originalKey ? await objectExists(originalKey) : false;
    const thumbnailExists = await objectExists(thumbnailKey);

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
  const method = event?.httpMethod || event?.requestContext?.http?.method || '';
  if (method !== 'GET') {
    return methodNotAllowed(`getAssetIntegrity only accepts GET method, you tried: ${method}`, event);
  }

  const authError = requireWriteApiKey(event);
  if (authError) {
    return authError;
  }

  return buildAssetIntegrityResponse(event?.pathParameters?.id, event);
};
