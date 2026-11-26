import { deleteAssetHandler, listDeletedAssetsHandler, restoreAssetHandler } from '../handlers/assets/delete-asset.mjs';
import { getAssetIntegrityHandler } from '../handlers/assets/get-asset-integrity.mjs';
import { putItemHandler } from '../handlers/put-item.mjs';
import { updateTagsHandler } from '../handlers/tags/update-tags.mjs';
import { signUploadHandler } from '../handlers/uploads/sign-upload.mjs';
import { createRouter } from '../lib/router.mjs';

// Uploads and repair: desktop write key or mobile session (delete is desktop key only).
export const routes = {
  'POST /api': putItemHandler,
  'OPTIONS /api': putItemHandler,
  'POST /api/uploads/sign': signUploadHandler,
  'OPTIONS /api/uploads/sign': signUploadHandler,
  'GET /api/assets/{id}/integrity': getAssetIntegrityHandler,
  'OPTIONS /api/assets/{id}/integrity': getAssetIntegrityHandler,
  'PATCH /api/assets/{id}/tags': updateTagsHandler,
  'OPTIONS /api/assets/{id}/tags': updateTagsHandler,
  'DELETE /api/assets/{id}': deleteAssetHandler,
  'OPTIONS /api/assets/{id}': deleteAssetHandler,
  'POST /api/assets/{id}/restore': restoreAssetHandler,
  'OPTIONS /api/assets/{id}/restore': restoreAssetHandler,
  'GET /api/desktop/deleted': listDeletedAssetsHandler,
  'OPTIONS /api/desktop/deleted': listDeletedAssetsHandler
};

export const handler = createRouter(routes);
