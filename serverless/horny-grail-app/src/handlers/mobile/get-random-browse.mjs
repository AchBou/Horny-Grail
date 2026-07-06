import { requireMobileReadToken } from '../../lib/auth.mjs';
import { corsPreflight, badRequest, jsonResponse, methodNotAllowed, serverError } from '../../lib/http.mjs';
import { createSignedMediaView } from '../../lib/mobile-media.mjs';
import { fetchRandomBrowsePage, parseRandomBrowseLimit } from '../../lib/random-browse.mjs';

function getQueryParam(event, key) {
  return event?.queryStringParameters?.[key] ?? null;
}

export const getMobileRandomBrowseHandler = async (event) => {
  const method = event?.httpMethod || event?.requestContext?.http?.method || '';
  if (method === 'OPTIONS') {
    return corsPreflight(event);
  }
  if (method && method !== 'GET') {
    return methodNotAllowed(`getMobileRandomBrowse only accepts GET method, you tried: ${method}`, event);
  }

  const authError = requireMobileReadToken(event);
  if (authError) {
    return authError;
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
      items: signedItems,
    }, event);
  } catch (error) {
    console.error('Error browsing mobile random images:', error);
    return serverError('Failed to browse random images', event);
  }
};
