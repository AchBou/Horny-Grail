import { requireWriteApiKey } from '../../lib/auth.mjs';
import { badRequest, jsonResponse, serverError } from '../../lib/http.mjs';
import { deleteItemById } from '../../lib/items-repository.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';
import { isValidImageId } from '../../lib/validation.mjs';

export const deleteAssetHandler = async (event) => {
  const guardError = guardRequest(event, {
    handlerName: 'deleteAsset',
    method: 'DELETE',
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

  try {
    const deletedItem = await deleteItemById(id);
    return jsonResponse(200, {
      id,
      metadataDeleted: Boolean(deletedItem)
    }, event);
  } catch (error) {
    console.error('Error deleting asset metadata', { id, error });
    return serverError('Failed to delete asset metadata', event);
  }
};
