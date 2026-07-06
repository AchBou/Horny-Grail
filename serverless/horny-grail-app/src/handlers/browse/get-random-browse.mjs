import { requireReadOriginSecret } from '../../lib/auth.mjs';
import { badRequest, jsonResponse, serverError } from '../../lib/http.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';
import { fetchRandomBrowsePage, parseRandomBrowseLimit } from '../../lib/random-browse.mjs';

function getQueryParam(event, key) {
  return event?.queryStringParameters?.[key] ?? null;
}

export const getRandomBrowseHandler = async (event) => {
  const guardError = guardRequest(event, {
    handlerName: 'getRandomBrowse',
    method: 'GET',
    allowMissingMethod: true,
    authorize: requireReadOriginSecret
  });
  if (guardError) {
    return guardError;
  }

  const limit = parseRandomBrowseLimit(getQueryParam(event, 'limit'));
  if (limit == null) {
    return badRequest('Invalid limit. Expected an integer between 1 and 48.', event);
  }

  try {
    const page = await fetchRandomBrowsePage(getQueryParam(event, 'cursor'), limit);
    if (!page) {
      return badRequest('Invalid cursor', event);
    }

    return jsonResponse(200, page, event);
  } catch (error) {
    console.error('Error browsing random images:', error);
    return serverError('Failed to browse random images', event);
  }
};
