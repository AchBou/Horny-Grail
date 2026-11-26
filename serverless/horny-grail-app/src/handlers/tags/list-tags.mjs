import { requireMobileReadToken, requireReadOriginSecret, requireWriteApiKey } from '../../lib/auth.mjs';
import { jsonResponse, serverError } from '../../lib/http.mjs';
import { loadActiveItems } from '../../lib/random-browse.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';
import { countTags, itemTags } from '../../lib/tags.mjs';

/** Every tag in use with its item count, plus how many items have no tags yet. */
function createListTagsHandler({ handlerName, authorize, allowOptions = true }) {
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

    try {
      const items = await loadActiveItems();
      return jsonResponse(200, {
        tags: countTags(items),
        total: items.length,
        untagged: items.filter((item) => itemTags(item).length === 0).length
      }, event);
    } catch (error) {
      console.error(`${handlerName} failed`, error);
      return serverError('Failed to list tags', event);
    }
  };
}

// The website, through CloudFront like its other reads (same origin, so no preflight).
export const listWebTagsHandler = createListTagsHandler({
  handlerName: 'listWebTags',
  authorize: requireReadOriginSecret,
  allowOptions: false
});

export const listMobileTagsHandler = createListTagsHandler({
  handlerName: 'listMobileTags',
  authorize: requireMobileReadToken
});

export const listDesktopTagsHandler = createListTagsHandler({
  handlerName: 'listDesktopTags',
  authorize: requireWriteApiKey
});
