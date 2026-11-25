import { requireMobileReadToken, requireReadOriginSecret } from '../lib/auth.mjs';
import { badRequest, jsonResponse, notFound, serverError } from '../lib/http.mjs';
import { getItemById } from '../lib/items-repository.mjs';
import { createSignedMediaView } from '../lib/mobile-media.mjs';
import { guardRequest } from '../lib/request-guards.mjs';
import { isValidImageId } from '../lib/validation.mjs';

/** Web and mobile lookups share everything except auth and how the item is presented. */
function createGetByIdHandler({ handlerName, authorize, allowOptions = false, presentItem = null }) {
  return async (event) => {
    const guardError = await guardRequest(event, {
      handlerName,
      method: 'GET',
      allowOptions,
      authorize
    });
    if (guardError) {
      return guardError;
    }

    const id = event?.pathParameters?.id;
    if (!isValidImageId(id)) {
      return badRequest('Invalid image id', event);
    }

    try {
      const item = await getItemById(id);
      if (!presentItem) {
        // The web client treats a null body as "not found".
        return jsonResponse(200, item || null, event);
      }
      if (!item) {
        return notFound('Media was not found', event);
      }
      return jsonResponse(200, await presentItem(item), event);
    } catch (error) {
      console.error(`${handlerName} failed`, { id, error: error?.message || String(error) });
      return serverError('Failed to get item', event);
    }
  };
}

export const getByIdHandler = createGetByIdHandler({
  handlerName: 'getById',
  authorize: requireReadOriginSecret
});

// Mobile items carry presigned S3 URLs because the app has no CloudFront cookies.
export const getMobileByIdHandler = createGetByIdHandler({
  handlerName: 'getMobileById',
  authorize: requireMobileReadToken,
  allowOptions: true,
  presentItem: createSignedMediaView
});
