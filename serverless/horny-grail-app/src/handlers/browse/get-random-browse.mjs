import { requireReadOriginSecret } from '../../lib/auth.mjs';
import { badRequest, jsonResponse, methodNotAllowed, serverError } from '../../lib/http.mjs';
import { fetchRandomBrowsePage, parseRandomBrowseLimit } from '../../lib/random-browse.mjs';

function getQueryParam(event, key) {
  return event?.queryStringParameters?.[key] ?? null;
}

export const getRandomBrowseHandler = async (event) => {
  const method = event?.httpMethod || event?.requestContext?.http?.method || '';
  if (method && method !== 'GET') {
    return methodNotAllowed(`getRandomBrowse only accepts GET method, you tried: ${method}`, event);
  }

  const authError = requireReadOriginSecret(event);
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

    return jsonResponse(200, page, event);
  } catch (error) {
    console.error('Error browsing random images:', error);
    return serverError('Failed to browse random images', event);
  }
};
