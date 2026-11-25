import { requireWriteAccess } from '../../lib/auth.mjs';
import { badRequest, jsonResponse, serverError } from '../../lib/http.mjs';
import { getItemById } from '../../lib/items-repository.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';
import { findMissingAssets } from '../../lib/s3-objects.mjs';
import { isValidImageExt, isValidImageId } from '../../lib/validation.mjs';

async function buildAssetIntegrityResponse(id, event) {
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
    const missing = await findMissingAssets(id, isValidImageExt(ext) ? ext : null);
    const originalExists = !missing.includes('original');
    const thumbnailExists = !missing.includes('thumbnail');

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
    console.error('Error checking asset integrity', { id, error: error?.message || String(error) });
    return serverError('Failed to check asset integrity', event);
  }
}

export const getAssetIntegrityHandler = async (event) => {
  const guardError = await guardRequest(event, {
    handlerName: 'getAssetIntegrity',
    method: 'GET',
    allowOptions: true,
    authorize: requireWriteAccess
  });
  if (guardError) {
    return guardError;
  }

  return buildAssetIntegrityResponse(event?.pathParameters?.id, event);
};
