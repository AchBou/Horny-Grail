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

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }
}

function createProgress(update) {
  return (phase, detail = null) => update?.(phase, detail);
}

async function uploadSignedBinary(label, uploadUrl, body, headers, signal) {
  try {
    await putBinary(uploadUrl, body, headers, { signal });
  } catch (error) {
    throw new Error(`${label} upload failed: ${error?.message || String(error)}`);
  }
}

function toThumbnailFile(thumbnailBlob, id) {
  if (thumbnailBlob instanceof File) {
    return thumbnailBlob;
  }

  return new File([thumbnailBlob], `thumbnail-${id}.jpeg`, {
    type: THUMBNAIL_MIME_TYPE,
    lastModified: Date.now()
  });
}

async function uploadOriginal(file, id, ext, signal) {
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
  }, { signal });

  await uploadSignedBinary(
    'Original',
    uploadTarget.uploadUrl,
    file,
    uploadTarget.headers || { 'Content-Type': contentType },
    signal
  );
}

async function uploadThumbnailBlob(thumbnailBlob, id, signal) {
  const thumbnailFile = toThumbnailFile(thumbnailBlob, id);

  const uploadTarget = await signUpload({
    path: 'thumbnails',
    id,
    ext: THUMBNAIL_EXT,
    sizeBytes: thumbnailFile.size,
    contentType: THUMBNAIL_MIME_TYPE
  }, { signal });

  await uploadSignedBinary(
    'Thumbnail',
    uploadTarget.uploadUrl,
    thumbnailFile,
    uploadTarget.headers || { 'Content-Type': THUMBNAIL_MIME_TYPE },
    signal
  );
}

async function retryableUploadStage(stageFn, verifyIntegrity, isStageSatisfied, attempts = 3, signal = null) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    throwIfAborted(signal);

    const integrity = await verifyIntegrity();
    if (isStageSatisfied(integrity)) {
      return integrity;
    }

    try {
      await stageFn();
      return await verifyIntegrity();
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }

      lastError = error;
      if (attempt === attempts - 1) {
        throw error;
      }
    }
  }

  throw lastError || new Error('Upload stage failed');
}

export async function runUploadFlow(file, updateStatus, { signal = null } = {}) {
  const progress = createProgress(updateStatus);
  const ext = getExtensionFromFile(file);
  if (!ext) {
    throw new Error(`Unsupported file: ${file.name}`);
  }

  throwIfAborted(signal);
  progress('hashing');
  const id = await hashFile(file, signal);

  throwIfAborted(signal);
  progress('checking', { id });

  const verifyIntegrity = async () => fetchAssetIntegrity(id, { signal });
  let integrity = await verifyIntegrity();
  const startedAsRepair = Boolean(integrity?.metadataExists && integrity?.repairRequired);

  if (integrity?.metadataExists && integrity.originalExists && integrity.thumbnailExists) {
    progress('duplicate', { id, integrity });
    return { id, ext, integrity, outcome: 'duplicate' };
  }

  if (!integrity?.originalExists) {
    throwIfAborted(signal);
    progress(integrity?.metadataExists ? 'repairing-original' : 'uploading-original', { id });
    integrity = await retryableUploadStage(
      () => uploadOriginal(file, id, ext, signal),
      verifyIntegrity,
      (nextIntegrity) => Boolean(nextIntegrity?.originalExists),
      3,
      signal
    );
  }

  if (!integrity?.thumbnailExists) {
    throwIfAborted(signal);
    progress('thumbnailing', { id });
    const thumbnailBlob = await createThumbnail(file, { signal });

    throwIfAborted(signal);
    progress(integrity?.metadataExists ? 'repairing-thumbnail' : 'uploading-thumbnail', { id });
    integrity = await retryableUploadStage(
      () => uploadThumbnailBlob(thumbnailBlob, id, signal),
      verifyIntegrity,
      (nextIntegrity) => Boolean(nextIntegrity?.thumbnailExists),
      3,
      signal
    );
  }

  if (!integrity?.metadataExists) {
    throwIfAborted(signal);
    progress('registering', { id });
    await registerMetadata(id, ext, { signal });
    integrity = await verifyIntegrity();
  }

  const complete = Boolean(integrity?.metadataExists && integrity?.originalExists && integrity?.thumbnailExists);
  progress(complete ? 'complete' : 'failed', { id, integrity });

  if (!complete) {
    throw new Error('Upload finished but asset integrity is still incomplete');
  }

  return {
    id,
    ext,
    integrity,
    outcome: startedAsRepair ? 'repaired' : 'uploaded'
  };
}
