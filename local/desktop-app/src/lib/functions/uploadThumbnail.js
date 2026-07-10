import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { WRITE_API_KEY, buildApiUrl } from "../config/apiEnv.js";
import { httpFetch } from "../config/httpClient.js";

const MAX_DIMENSION = 320;
const JPEG_QUALITY = 90; // 1..100 for native encoder, converted for canvas fallback
const NATIVE_THUMB_TIMEOUT_MS = 8000;
const MEDIA_DECODE_TIMEOUT_MS = 10000;
const NETWORK_TIMEOUT_MS = 20000;

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, timeoutMs, label) {
  let timeoutId = 0;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

/**
 * Normalize Uint8Array-backed data to a plain ArrayBuffer for DOM APIs.
 * @param {Uint8Array} bytes
 * @returns {ArrayBuffer}
 */
function toArrayBuffer(bytes) {
  return new Uint8Array(bytes).buffer;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function getFileExt(filePath) {
  return filePath.split('.').pop()?.toLowerCase() || '';
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Native ffmpeg already proved the input is not a decodable video stream.
 * Running the browser decode fallback after these errors only hides the cause.
 * @param {unknown} error
 * @returns {boolean}
 */
function isUnrecoverableVideoDecodeError(error) {
  const message = errorMessage(error).toLowerCase();
  return [
    'invalid data found when processing input',
    'ebml header parsing failed',
    'error opening input',
    'moov atom not found',
    'failed to decode video'
  ].some((token) => message.includes(token));
}

/**
 * @param {Uint8Array} srcBytes
 * @returns {Promise<HTMLImageElement>}
 */
async function bytesToImage(srcBytes) {
  return withTimeout(new Promise((resolve, reject) => {
    try {
      const blob = new Blob([toArrayBuffer(srcBytes)]);
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to decode image'));
      };
      img.src = url;
    } catch (e) {
      reject(e);
    }
  }), MEDIA_DECODE_TIMEOUT_MS, 'Image decode');
}

/**
 * @param {Uint8Array} srcBytes
 * @returns {Promise<{ video: HTMLVideoElement, revoke: () => void }>}
 */
async function bytesToVideo(srcBytes) {
  return withTimeout(new Promise((resolve, reject) => {
    try {
      const blob = new Blob([toArrayBuffer(srcBytes)], { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const video = document.createElement('video');
      let settled = false;
      const cleanup = () => {
        video.onloadedmetadata = null;
        video.onerror = null;
      };
      const revoke = () => URL.revokeObjectURL(url);

      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ video, revoke });
      };
      video.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        revoke();
        reject(new Error('Failed to decode video'));
      };
      video.src = url;
      video.load();
    } catch (e) {
      reject(e);
    }
  }), MEDIA_DECODE_TIMEOUT_MS, 'Video decode');
}

/**
 * @param {number} duration
 * @returns {number[]}
 */
function getVideoSampleTimes(duration) {
  if (!Number.isFinite(duration) || duration <= 0.15) {
    return [0];
  }

  if (duration < 2) {
    return [duration * 0.5, duration * 0.75, duration * 0.25];
  }

  const maxTime = Math.max(0, duration - 0.1);
  return [0.15, duration * 0.1, duration * 0.25, duration * 0.5, duration * 0.75]
    .map((time) => Math.min(Math.max(time, 0), maxTime))
    .filter((time, index, times) => index === 0 || Math.abs(time - times[index - 1]) > 0.05);
}

/**
 * Wait until the video can render a stable frame at the requested timestamp.
 * @param {HTMLVideoElement} video
 * @param {number} targetTime
 * @returns {Promise<void>}
 */
async function prepareVideoFrame(video, targetTime) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise((resolve, reject) => {
      /** @returns {void} */
      const onLoadedData = () => {
        cleanup();
        resolve(undefined);
      };
      const onError = () => {
        cleanup();
        reject(new Error('Failed while loading video frame'));
      };
      const cleanup = () => {
        video.removeEventListener('loadeddata', onLoadedData);
        video.removeEventListener('error', onError);
      };

      video.addEventListener('loadeddata', onLoadedData, { once: true });
      video.addEventListener('error', onError, { once: true });
    });
  }

  if (targetTime <= 0) {
    await waitForPaintedVideoFrame(video);
    return;
  }

  await new Promise((resolve, reject) => {
    /** @returns {void} */
    const onSeeked = () => {
      cleanup();
      resolve(undefined);
    };
    const onError = () => {
      cleanup();
      reject(new Error('Failed while seeking video frame'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = targetTime;
  });

  await waitForPaintedVideoFrame(video);
}

/**
 * @param {HTMLVideoElement} video
 * @returns {Promise<void>}
 */
async function waitForPaintedVideoFrame(video) {
  await new Promise((resolve) => {
    if ('requestVideoFrameCallback' in video) {
      video.requestVideoFrameCallback(() => resolve(undefined));
      return;
    }
    requestAnimationFrame(() => resolve(undefined));
  });
}

/**
 * @param {CanvasImageSource} source
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @returns {boolean}
 */
function isMostlyBlackFrame(source, sourceWidth, sourceHeight) {
  if (!sourceWidth || !sourceHeight) {
    return true;
  }

  const sampleSize = 64;
  const canvas = document.createElement('canvas');
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return false;
  }

  ctx.drawImage(source, 0, 0, sampleSize, sampleSize);
  const pixels = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
  let luminanceTotal = 0;
  let visiblePixels = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    luminanceTotal += luminance;
    if (luminance > 18) {
      visiblePixels += 1;
    }
  }

  const pixelCount = sampleSize * sampleSize;
  const averageLuminance = luminanceTotal / pixelCount;
  const visibleRatio = visiblePixels / pixelCount;
  return averageLuminance < 10 && visibleRatio < 0.02;
}

/**
 * @param {CanvasImageSource} source
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} maxDim
 * @param {number} quality
 * @param {string} background
 * @returns {Promise<Uint8Array>}
 */
async function drawContainedJpeg(source, sourceWidth, sourceHeight, maxDim, quality, background = '#ffffff') {
  if (!sourceWidth || !sourceHeight) throw new Error('Invalid media dimensions');

  const scale = Math.min(maxDim / sourceWidth, maxDim / sourceHeight);
  const tw = Math.max(1, Math.round(sourceWidth * scale));
  const th = Math.max(1, Math.round(sourceHeight * scale));
  const dx = Math.floor((maxDim - tw) / 2);
  const dy = Math.floor((maxDim - th) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = maxDim;
  canvas.height = maxDim;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, maxDim, maxDim);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, dx, dy, tw, th);

  const blob = await new Promise(
    /** @returns {void} */
    (resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality / 100)
  );
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * @param {Uint8Array} srcBytes
 * @param {string} mimeType
 * @param {number} [maxDim]
 * @param {number} [quality]
 * @returns {Promise<Uint8Array>}
 */
async function makeJpegThumbnailBytes(srcBytes, mimeType = 'application/octet-stream', maxDim = MAX_DIMENSION, quality = JPEG_QUALITY) {
  if (mimeType === 'video/webm') {
    const { video, revoke } = await bytesToVideo(srcBytes);
    try {
      const iw = video.videoWidth;
      const ih = video.videoHeight;
      let fallbackThumb = null;

      for (const sampleTime of getVideoSampleTimes(video.duration)) {
        await prepareVideoFrame(video, sampleTime);
        const thumb = await drawContainedJpeg(video, iw, ih, maxDim, quality, '#111827');

        if (!fallbackThumb) {
          fallbackThumb = thumb;
        }

        if (!isMostlyBlackFrame(video, iw, ih)) {
          return thumb;
        }
      }

      if (fallbackThumb) {
        return fallbackThumb;
      }

      throw new Error('Failed to capture a video thumbnail frame');
    } finally {
      revoke();
      video.removeAttribute('src');
      video.load();
    }
  }

  const img = await bytesToImage(srcBytes);
  return drawContainedJpeg(
    img,
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
    maxDim,
    quality,
    '#ffffff'
  );
}

/**
 * @param {string} filePath
 * @param {string} hex
 * @returns {Promise<string>}
 */
export async function uploadThumbnail(filePath, hex) {
  const fileExt = getFileExt(filePath);
  const isWebm = fileExt === 'webm';
  let thumbBytes;
  let nativeThumbnailError = null;
  if (isWebm) {
    try {
      const nativeVideoThumbBytes = await withTimeout(invoke('generate_video_thumbnail', {
        path: filePath,
        maxDimension: MAX_DIMENSION,
        qualityHint: JPEG_QUALITY
      }), NATIVE_THUMB_TIMEOUT_MS, 'Native video thumbnail generation');
      thumbBytes = Uint8Array.from(/** @type {number[]} */ (nativeVideoThumbBytes));
    } catch (error) {
      nativeThumbnailError = error;
      if (isUnrecoverableVideoDecodeError(error)) {
        throw new Error(`Failed to generate video thumbnail: ${errorMessage(error)}`);
      }
      console.warn('Falling back to JS video thumbnail generation:', error);
    }
  } else {
    try {
      const nativeThumbBytes = await withTimeout(invoke('generate_thumbnail', {
        path: filePath,
        maxDimension: MAX_DIMENSION,
        qualityHint: JPEG_QUALITY
      }), NATIVE_THUMB_TIMEOUT_MS, 'Native thumbnail generation');
      thumbBytes = Uint8Array.from(/** @type {number[]} */ (nativeThumbBytes));
    } catch (error) {
      console.warn('Falling back to JS thumbnail generation:', error);
    }
  }

  if (!thumbBytes) {
    const srcBytes = await readFile(filePath);
    try {
      thumbBytes = await makeJpegThumbnailBytes(
        srcBytes,
        isWebm ? 'video/webm' : `image/${fileExt || 'jpeg'}`,
        MAX_DIMENSION,
        JPEG_QUALITY
      );
    } catch (fallbackError) {
      if (nativeThumbnailError) {
        throw new Error(
          `Failed to generate thumbnail: ${errorMessage(nativeThumbnailError)}. JS fallback also failed: ${errorMessage(fallbackError)}`
        );
      }
      throw fallbackError;
    }
  }

  const signResponse = await withTimeout(httpFetch(buildApiUrl("/uploads/sign"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": WRITE_API_KEY
    },
    body: JSON.stringify({
      path: "thumbnails",
      id: hex,
      ext: "jpeg",
      sizeBytes: thumbBytes.byteLength,
      contentType: "image/jpeg"
    })
  }), NETWORK_TIMEOUT_MS, 'Thumbnail sign request');

  if (!signResponse.ok) {
    throw new Error(`Failed to request thumbnail upload URL: ${signResponse.status}`);
  }

  const uploadTarget = await signResponse.json();

  const res = await withTimeout(httpFetch(uploadTarget.uploadUrl, {
    method: 'PUT',
    body: new Blob([toArrayBuffer(thumbBytes)], { type: 'image/jpeg' }),
    headers: uploadTarget.headers || { 'Content-Type': 'image/jpeg' }
  }), NETWORK_TIMEOUT_MS, 'Thumbnail upload');

  if (!res.ok) {
    throw new Error(`S3 thumbnail upload via presigned URL failed with status ${res.status}`);
  }
  console.log('Thumbnail Upload Success via presigned URL');
  return hex;
}
