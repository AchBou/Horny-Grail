const MIME_BY_EXT = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webm: 'video/webm'
});

export const THUMBNAIL_MIME_TYPE = 'image/jpeg';
export const THUMBNAIL_EXT = 'jpeg';
export const SUPPORTED_EXTENSIONS = Object.keys(MIME_BY_EXT);

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getExtensionFromFile(file) {
  const fromName = file.name.split('.').pop()?.toLowerCase() || '';
  if (MIME_BY_EXT[fromName]) {
    return fromName;
  }

  const fromType = Object.entries(MIME_BY_EXT).find(([, mimeType]) => mimeType === file.type);
  return fromType?.[0] || '';
}

export function getMimeTypeFromExtension(ext) {
  return MIME_BY_EXT[ext] || null;
}

export async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return bytesToHex(new Uint8Array(hashBuffer));
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image'));
    };

    image.src = url;
  });
}

function loadVideoFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    video.onloadedmetadata = () => resolve({ video, url });
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode video'));
    };

    video.src = url;
    video.load();
  });
}

function blobFromCanvas(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('Failed to encode thumbnail'));
    }, THUMBNAIL_MIME_TYPE, 0.9);
  });
}

function drawContainedImage(source, sourceWidth, sourceHeight, background = '#ffffff') {
  const size = 320;
  const scale = Math.min(size / sourceWidth, size / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const x = Math.floor((size - width) / 2);
  const y = Math.floor((size - height) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x, y, width, height);

  return canvas;
}

async function seekVideo(video, targetTime) {
  if (targetTime <= 0) {
    return;
  }

  await new Promise((resolve, reject) => {
    video.onseeked = () => resolve(undefined);
    video.onerror = () => reject(new Error('Failed while seeking video'));
    video.currentTime = targetTime;
  });
}

export async function createThumbnail(file) {
  const ext = getExtensionFromFile(file);
  if (!ext) {
    throw new Error('Unsupported file type');
  }

  if (ext === 'webm') {
    const { video, url } = await loadVideoFromBlob(file);

    try {
      await seekVideo(video, Math.min(Math.max(video.duration * 0.25, 0), Math.max(video.duration - 0.1, 0)));
      const canvas = drawContainedImage(video, video.videoWidth, video.videoHeight, '#111827');
      return await blobFromCanvas(canvas);
    } finally {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    }
  }

  const image = await loadImageFromBlob(file);
  const canvas = drawContainedImage(
    image,
    image.naturalWidth || image.width,
    image.naturalHeight || image.height
  );
  return blobFromCanvas(canvas);
}
