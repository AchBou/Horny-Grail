import { requireMobileReadToken } from '../../lib/auth.mjs';
import { badRequest, corsPreflight, jsonResponse, methodNotAllowed, notFound, serverError } from '../../lib/http.mjs';
import { getItemById } from '../../lib/items-repository.mjs';
import { createSignedMediaView } from '../../lib/mobile-media.mjs';
import { isValidImageId } from '../../lib/validation.mjs';

export const getMobileByIdHandler = async (event) => {
  const method = event?.httpMethod || event?.requestContext?.http?.method || '';
  if (method === 'OPTIONS') {
    return corsPreflight(event);
  }
  if (method !== 'GET') {
    return methodNotAllowed(`getMobileById only accepts GET method, you tried: ${method}`, event);
  }

  const authError = requireMobileReadToken(event);
  if (authError) {
    return authError;
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
