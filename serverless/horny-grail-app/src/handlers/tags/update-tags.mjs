import { requireWriteApiKey } from '../../lib/auth.mjs';
import { badRequest, jsonResponse, notFound, serverError } from '../../lib/http.mjs';
import { getItemById, setItemTags } from '../../lib/items-repository.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';
import { applyTagChange, itemTags, MAX_TAGS_PER_ITEM, parseTagList } from '../../lib/tags.mjs';
import { isValidImageId, parseJsonBody } from '../../lib/validation.mjs';

/**
 * PATCH /api/assets/{id}/tags with { add: [...], remove: [...] }. Tagging is desktop-only,
 * so this takes the write key, not a mobile session. Returns the item's tags afterwards.
 */
export const updateTagsHandler = async (event) => {
  const guardError = await guardRequest(event, {
    handlerName: 'updateTags',
    method: 'PATCH',
    allowOptions: true,
    authorize: requireWriteApiKey
  });
  if (guardError) {
    return guardError;
  }

  const id = event?.pathParameters?.id;
  if (!isValidImageId(id)) {
    return badRequest('Invalid image id', event);
  }

  const body = parseJsonBody(event);
  const add = parseTagList(body?.add);
  const remove = parseTagList(body?.remove);
  if (!body || !add || !remove) {
    return badRequest('Invalid tags: use letters, digits, spaces, "-" or "_", up to 32 characters each', event);
  }

  try {
    const item = await getItemById(id);
    if (!item) {
      return notFound('Item not found', event);
    }

    const current = itemTags(item);
    const tags = applyTagChange(current, { add, remove });
    if (tags.length > MAX_TAGS_PER_ITEM) {
      return badRequest(`An item can have at most ${MAX_TAGS_PER_ITEM} tags`, event);
    }

    const unchanged = tags.length === current.length && tags.every((tag, index) => tag === current[index]);
    if (!unchanged) {
      await setItemTags(id, tags);
    }
    return jsonResponse(200, { id, tags }, event);
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      return notFound('Item not found', event);
    }
    console.error('updateTags failed', { id, error });
    return serverError('Failed to update tags', event);
  }
};
