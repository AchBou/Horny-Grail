import { requireMobileReadToken } from '../../lib/auth.mjs';
import { badRequest, jsonResponse, serverError } from '../../lib/http.mjs';
import { createSignedMediaView } from '../../lib/mobile-media.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';
import { fetchRandomBrowsePage, parseRandomBrowseLimit } from '../../lib/random-browse.mjs';

function getQueryParam(event, key) {
  return event?.queryStringParameters?.[key] ?? null;
}

export const getMobileRandomBrowseHandler = async (event) => {
  const guardError = guardRequest(event, {
    handlerName: 'getMobileRandomBrowse',
    method: 'GET',
    allowOptions: true,
    allowMissingMethod: true,
    authorize: requireMobileReadToken
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

    const signedItems = await Promise.all(page.items.map((item) => createSignedMediaView(item)));

    return jsonResponse(200, {
      ...page,
      items: signedItems
    }, event);
  } catch (error) {
    console.error('Error browsing mobile random images:', error);
    return serverError('Failed to browse random images', event);
  }
};
