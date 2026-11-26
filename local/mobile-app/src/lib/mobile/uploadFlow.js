import {
  fetchAssetIntegrity,
  putBinary,
  registerMetadata,
  signUpload
} from '$lib/mobile/api.js';
import {
  THUMBNAIL_EXT,
  THUMBNAIL_MIME_TYPE,
  createThumbnail,
  getExtensionFromFile,
  getMimeTypeFromExtension,
  hashFile
} from '$lib/mobile/media.js';
import { createUploadFlow } from '$lib/mobile/uploadFlowCore.js';

export const runUploadFlow = createUploadFlow({
  fetchAssetIntegrity,
  putBinary,
  registerMetadata,
  signUpload,
  THUMBNAIL_EXT,
  THUMBNAIL_MIME_TYPE,
  createThumbnail,
  getExtensionFromFile,
  getMimeTypeFromExtension,
  hashFile
});
