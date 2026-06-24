import { Capacitor, registerPlugin } from '@capacitor/core';

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

const THUMBNAIL_SIZE = 320;
const THUMBNAIL_QUALITY = 0.9;
const NATIVE_THUMBNAIL_QUALITY = 90;

const HornyGrailMedia = registerPlugin('HornyGrailMedia');

export const THUMBNAIL_MIME_TYPE = 'image/jpeg';
export const THUMBNAIL_EXT = 'jpeg';
export const SUPPORTED_EXTENSIONS = Object.keys(MIME_BY_EXT);

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
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
    }, THUMBNAIL_MIME_TYPE, THUMBNAIL_QUALITY);
  });
}

function drawContainedImage(source, sourceWidth, sourceHeight, background = '#ffffff') {
  const scale = Math.min(THUMBNAIL_SIZE / sourceWidth, THUMBNAIL_SIZE / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const x = Math.floor((THUMBNAIL_SIZE - width) / 2);
  const y = Math.floor((THUMBNAIL_SIZE - height) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file for native thumbnail generation'));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error('Failed to decode native thumbnail data');
  }

  return response.blob();
}

function normalizeNativeThumbnailResult(result) {
  const dataUrl = result?.thumbnailDataUrl || result?.dataUrl;
  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/jpeg;base64,')) {
    return dataUrl;
  }

  const base64 = result?.thumbnailBase64 || result?.jpegBase64;
  if (typeof base64 === 'string' && base64.length > 0) {
    return `data:image/jpeg;base64,${base64}`;
  }

  throw new Error('Native thumbnail plugin returned no JPEG data');
}

async function createNativeVideoThumbnail(file, signal) {
  throwIfAborted(signal);

  try {
    const sourceDataUrl = await blobToDataUrl(file);
    throwIfAborted(signal);

    const result = await HornyGrailMedia.createVideoThumbnail({
      sourceDataUrl,
      mimeType: file.type || MIME_BY_EXT.webm,
      maxDimension: THUMBNAIL_SIZE,
      quality: NATIVE_THUMBNAIL_QUALITY
    });
    throwIfAborted(signal);

    return dataUrlToBlob(normalizeNativeThumbnailResult(result));
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }

    const reason = error?.message || String(error);
    throw new Error(`Native WebM thumbnail generation failed. Register the HornyGrailMedia Capacitor plugin before uploading WebM on mobile. ${reason}`);
  }
}

async function createWebPreviewVideoThumbnail(file, signal) {
  const { video, url } = await loadVideoFromBlob(file);

  try {
    throwIfAborted(signal);
    await seekVideo(video, Math.min(Math.max(video.duration * 0.25, 0), Math.max(video.duration - 0.1, 0)));
    throwIfAborted(signal);

    const canvas = drawContainedImage(video, video.videoWidth, video.videoHeight, '#111827');
    return await blobFromCanvas(canvas);
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
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

export async function hashFile(file, signal = null) {
  throwIfAborted(signal);
  const buffer = await file.arrayBuffer();
  throwIfAborted(signal);

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  throwIfAborted(signal);

  return bytesToHex(new Uint8Array(hashBuffer));
}

export async function createThumbnail(file, { signal = null } = {}) {
  const ext = getExtensionFromFile(file);
  if (!ext) {
    throw new Error('Unsupported file type');
  }

  if (ext === 'webm') {
    if (Capacitor.isNativePlatform()) {
      return createNativeVideoThumbnail(file, signal);
    }

    return createWebPreviewVideoThumbnail(file, signal);
  }

  throwIfAborted(signal);
  const image = await loadImageFromBlob(file);
  throwIfAborted(signal);

  const canvas = drawContainedImage(
    image,
    image.naturalWidth || image.width,
    image.naturalHeight || image.height
  );
  return blobFromCanvas(canvas);
}
