import { requireReadOriginSecret } from '../../lib/auth.mjs';
import { jsonResponse, notFound, serverError } from '../../lib/http.mjs';
import { pickRandomItem } from '../../lib/random-browse.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';

export const getRandomImageHandler = async (event) => {
  const guardError = await guardRequest(event, {
    handlerName: 'getRandomImage',
    method: 'GET',
    authorize: requireReadOriginSecret
  });
  if (guardError) {
    return guardError;
  }

  try {
    const item = await pickRandomItem();

    if (!item) {
      return notFound('No active images found', event);
    }

    return jsonResponse(200, {
      id: item.id,
      ext: item.ext
    }, event);
  } catch (err) {
    console.error('Error getting random image:', err);
    return serverError('Error getting random image. Please try again later.', event);
  }
};
