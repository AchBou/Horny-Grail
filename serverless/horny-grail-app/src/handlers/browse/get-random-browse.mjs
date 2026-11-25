import { requireMobileReadToken, requireReadOriginSecret, requireWriteApiKey } from '../../lib/auth.mjs';
import { badRequest, jsonResponse, serverError } from '../../lib/http.mjs';
import { createSignedMediaView } from '../../lib/mobile-media.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';
import { fetchRandomBrowsePage, parseRandomBrowseLimit } from '../../lib/random-browse.mjs';
import { parseTagFilter } from '../../lib/tags.mjs';

function getQueryParam(event, key) {
  return event?.queryStringParameters?.[key] ?? null;
}

/** Web and mobile browse share everything except auth and how items are presented. */
function createRandomBrowseHandler({ handlerName, authorize, allowOptions = false, presentItem = null }) {
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

    const limit = parseRandomBrowseLimit(getQueryParam(event, 'limit'));
    if (limit == null) {
      return badRequest('Invalid limit. Expected an integer between 1 and 48.', event);
    }

    const filter = parseTagFilter(event?.queryStringParameters);
    if (!filter) {
      return badRequest('Invalid tag filter', event);
    }

    try {
      const page = await fetchRandomBrowsePage(getQueryParam(event, 'cursor'), limit, filter);
      if (!page) {
        return badRequest('Invalid cursor', event);
      }

      const items = presentItem ? await Promise.all(page.items.map(presentItem)) : page.items;
      return jsonResponse(200, { ...page, items }, event);
    } catch (error) {
      console.error(`${handlerName} failed`, error);
      return serverError('Failed to browse random images', event);
    }
  };
}

export const getRandomBrowseHandler = createRandomBrowseHandler({
  handlerName: 'getRandomBrowse',
  authorize: requireReadOriginSecret
});

// Mobile items carry presigned S3 URLs because the app has no CloudFront cookies.
export const getMobileRandomBrowseHandler = createRandomBrowseHandler({
  handlerName: 'getMobileRandomBrowse',
  authorize: requireMobileReadToken,
  allowOptions: true,
  presentItem: createSignedMediaView
});

// The desktop app's Watch tab: the same feed with presigned URLs, authorized by the write key.
export const getDesktopRandomBrowseHandler = createRandomBrowseHandler({
  handlerName: 'getDesktopRandomBrowse',
  authorize: requireWriteApiKey,
  allowOptions: true,
  presentItem: createSignedMediaView
});
