import { requireWriteApiKey } from '../../lib/auth.mjs';
import { isDeleted, listDeletedItems, restoreItem, softDeleteItem } from '../../lib/deletion.mjs';
import { badRequest, conflict, jsonResponse, notFound, serverError } from '../../lib/http.mjs';
import { getItemById } from '../../lib/items-repository.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';
import { isValidImageId } from '../../lib/validation.mjs';

async function guardDesktop(event, handlerName, method) {
  return guardRequest(event, { handlerName, method, allowOptions: true, authorize: requireWriteApiKey });
}

/**
 * DELETE /api/assets/{id}: removes an item from the Grail. It disappears from every app at
 * once; its files and row stay restorable for 30 days (POST /api/assets/{id}/restore).
 * Desktop write key only.
 */
export const deleteAssetHandler = async (event) => {
  const guardError = await guardDesktop(event, 'deleteAsset', 'DELETE');
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
      return jsonResponse(200, { id, deleted: false }, event);
    }
    if (isDeleted(item)) {
      return jsonResponse(200, {
        id,
        deleted: true,
        deletedAt: item.deletedAt || null,
        restorableUntil: item.expiresAt ? new Date(item.expiresAt * 1000).toISOString() : null
      }, event);
    }

    const result = await softDeleteItem(item);
    console.info('deleteAsset succeeded', { id });
    return jsonResponse(200, { id, deleted: true, ...result }, event);
  } catch (error) {
    console.error('Error deleting asset', { id, error: error?.message || String(error) });
    return serverError('Failed to delete the item', event);
  }
};

/** POST /api/assets/{id}/restore: undoes a delete while the old file versions still exist. */
export const restoreAssetHandler = async (event) => {
  const guardError = await guardDesktop(event, 'restoreAsset', 'POST');
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
      return notFound('This item is gone for good', event);
    }
    if (!isDeleted(item)) {
      return jsonResponse(200, { id, restored: true, item }, event);
    }

    const result = await restoreItem(item);
    if (!result.restored) {
      return conflict('The deleted files are no longer available to restore', event, { missing: result.missing });
    }
    console.info('restoreAsset succeeded', { id });
    return jsonResponse(200, { id, restored: true, item: await getItemById(id) }, event);
  } catch (error) {
    console.error('Error restoring asset', { id, error: error?.message || String(error) });
    return serverError('Failed to restore the item', event);
  }
};

/** GET /api/desktop/deleted: deleted items that can still be restored, with a preview. */
export const listDeletedAssetsHandler = async (event) => {
  const guardError = await guardDesktop(event, 'listDeletedAssets', 'GET');
  if (guardError) {
    return guardError;
  }

  try {
    return jsonResponse(200, { items: await listDeletedItems() }, event);
  } catch (error) {
    console.error('Error listing deleted assets', { error: error?.message || String(error) });
    return serverError('Failed to list deleted items', event);
  }
};
