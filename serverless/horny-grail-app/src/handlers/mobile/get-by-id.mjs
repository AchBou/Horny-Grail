import { requireMobileReadToken } from '../../lib/auth.mjs';
import { badRequest, jsonResponse, notFound, serverError } from '../../lib/http.mjs';
import { getItemById } from '../../lib/items-repository.mjs';
import { createSignedMediaView } from '../../lib/mobile-media.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';
import { isValidImageId } from '../../lib/validation.mjs';

export const getMobileByIdHandler = async (event) => {
  const guardError = guardRequest(event, {
    handlerName: 'getMobileById',
    method: 'GET',
    allowOptions: true,
    authorize: requireMobileReadToken
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

    if (!item) {
      return notFound('Media was not found', event);
    }

    return jsonResponse(200, await createSignedMediaView(item), event);
  } catch (error) {
    console.error('Error getting mobile item', error);
    return serverError('Failed to get item', event);
  }
};
