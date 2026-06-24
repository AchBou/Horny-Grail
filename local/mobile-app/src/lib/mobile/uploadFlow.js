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

function createProgress(update) {
  return (phase, detail = null) => update?.(phase, detail);
}

async function uploadOriginal(file, id, ext) {
  const contentType = getMimeTypeFromExtension(ext);
  if (!contentType) {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  const uploadTarget = await signUpload({
    path: 'files',
    id,
    ext,
    sizeBytes: file.size,
    contentType
  });

  await putBinary(uploadTarget.uploadUrl, file, uploadTarget.headers || { 'Content-Type': contentType });
}

async function uploadThumbnail(file, id) {
  const thumbnailBlob = await createThumbnail(file);
  const uploadTarget = await signUpload({
    path: 'thumbnails',
    id,
    ext: THUMBNAIL_EXT,
    sizeBytes: thumbnailBlob.size,
    contentType: THUMBNAIL_MIME_TYPE
  });

  await putBinary(uploadTarget.uploadUrl, thumbnailBlob, uploadTarget.headers || { 'Content-Type': THUMBNAIL_MIME_TYPE });
}

async function retryableUploadStage(stageFn, verifyIntegrity, isStageSatisfied, attempts = 3) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const integrity = await verifyIntegrity();
    if (isStageSatisfied(integrity)) {
      return integrity;
    }

    try {
      await stageFn();
      return await verifyIntegrity();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) {
        throw error;
      }
    }
  }

  throw lastError || new Error('Upload stage failed');
}

export async function runUploadFlow(file, updateStatus) {
  const progress = createProgress(updateStatus);
  const ext = getExtensionFromFile(file);
  if (!ext) {
    throw new Error(`Unsupported file: ${file.name}`);
  }

  progress('hashing');
  const id = await hashFile(file);
  progress('checking', { id });

  const verifyIntegrity = async () => fetchAssetIntegrity(id);
  let integrity = await verifyIntegrity();
  const startedAsRepair = Boolean(integrity?.metadataExists && integrity?.repairRequired);

  if (integrity?.metadataExists && integrity.originalExists && integrity.thumbnailExists) {
    progress('duplicate', { id, integrity });
    return { id, ext, integrity, outcome: 'duplicate' };
  }

  if (!integrity?.originalExists) {
    progress(integrity?.metadataExists ? 'repairing-original' : 'uploading-original', { id });
    integrity = await retryableUploadStage(
      () => uploadOriginal(file, id, ext),
      verifyIntegrity,
      (nextIntegrity) => Boolean(nextIntegrity?.originalExists)
    );
  }

  if (!integrity?.thumbnailExists) {
    progress('thumbnailing', { id });
    progress(integrity?.metadataExists ? 'repairing-thumbnail' : 'uploading-thumbnail', { id });
    integrity = await retryableUploadStage(
      () => uploadThumbnail(file, id),
      verifyIntegrity,
      (nextIntegrity) => Boolean(nextIntegrity?.thumbnailExists)
    );
  }

  if (!integrity?.metadataExists) {
    progress('registering', { id });
    await registerMetadata(id, ext);
    integrity = await verifyIntegrity();
  }

  const repaired = Boolean(integrity?.repairRequired === false && integrity?.metadataExists);
  progress(repaired ? 'complete' : 'failed', { id, integrity });

  if (!integrity?.metadataExists || !integrity?.originalExists || !integrity?.thumbnailExists) {
    throw new Error('Upload finished but asset integrity is still incomplete');
  }

  return {
    id,
    ext,
    integrity,
    outcome: startedAsRepair ? 'repaired' : 'uploaded'
  };
}
