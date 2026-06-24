import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getBucketName, getBucketRegion, getWriteApiKey } from '../../config/env.mjs';
import { badRequest, corsPreflight, jsonResponse, methodNotAllowed, serverError, unauthorized } from '../../lib/http.mjs';
import {
  ORIGINAL_UPLOAD_MAX_BYTES,
  THUMBNAIL_UPLOAD_MAX_BYTES,
  getMimeTypeForImageExt,
  isValidContentLength,
  isValidImageExt,
  isValidImageId,
  normalizeImageExt,
  parseJsonBody
} from '../../lib/validation.mjs';

const s3Client = new S3Client({ region: getBucketRegion() });
const ALLOWED_PATHS = new Set(['files', 'thumbnails']);

/**
 * @param {import('@aws-sdk/client-s3').PutObjectCommandInput} input
 * @returns {Promise<string>}
 */
async function createSignedUrl(input) {
  const command = new PutObjectCommand(input);
  return getSignedUrl(s3Client, command, { expiresIn: 900 });
}

export const signUploadHandler = async (event) => {
  const method = event?.httpMethod || event?.requestContext?.http?.method || '';
  if (method === 'OPTIONS') {
    return corsPreflight(event);
  }

  if (method !== 'POST') {
    return methodNotAllowed(`signUpload only accepts POST method, you tried: ${method}`, event);
  }

  const providedKey = event?.headers?.['x-api-key'] || event?.headers?.['X-Api-Key'];
  if (!providedKey || providedKey !== getWriteApiKey()) {
    return unauthorized(event);
  }

  const body = parseJsonBody(event);
  if (!body) {
    return badRequest('Invalid JSON body', event);
  }

  const path = body.path;
  const id = body.id;
  const ext = body.ext;
  const contentType = body.contentType;
  const sizeBytes = body.sizeBytes;

  if (!ALLOWED_PATHS.has(path)) {
    return badRequest('Invalid upload path', event);
  }

  if (!isValidImageId(id)) {
    return badRequest('Invalid image id', event);
  }

  if (!isValidImageExt(ext)) {
    return badRequest('Invalid image extension', event);
  }

  const isThumbnail = path === 'thumbnails';
  const maxBytes = isThumbnail ? THUMBNAIL_UPLOAD_MAX_BYTES : ORIGINAL_UPLOAD_MAX_BYTES;
  if (!isValidContentLength(sizeBytes, maxBytes)) {
    return badRequest(`Invalid upload size; max is ${maxBytes} bytes`, event);
  }

  if (typeof contentType !== 'string') {
    return badRequest('Invalid content type', event);
  }

  const normalizedExt = normalizeImageExt(ext);
  const expectedContentType = isThumbnail ? 'image/jpeg' : getMimeTypeForImageExt(normalizedExt);
  if (contentType !== expectedContentType) {
    return badRequest('Content type does not match upload extension', event);
  }

  const objectKey = isThumbnail
    ? `${path}/thumbnail-${id}.jpeg`
    : `${path}/${id}.${normalizedExt}`;

  /** @type {import('@aws-sdk/client-s3').PutObjectCommandInput} */
  const commandInput = {
    Bucket: getBucketName(),
    Key: objectKey,
    ContentLength: sizeBytes,
    ContentType: expectedContentType
  };

  /** @type {Record<string, string> | undefined} */
  const headers = {
    'Content-Type': expectedContentType
  };

  try {
    const uploadUrl = await createSignedUrl(commandInput);
    return jsonResponse(200, {
      uploadUrl,
      key: objectKey,
      headers
    }, event);
  } catch (error) {
    console.error('Error creating upload URL', error);
    return serverError('Failed to create upload URL', event);
  }
};
