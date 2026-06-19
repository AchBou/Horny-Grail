import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { WRITE_API_KEY, buildApiUrl } from "../config/apiEnv.js";

const MAX_DIMENSION = 320;
const JPEG_QUALITY = 90; // 1..100 for native encoder, converted for canvas fallback

/**
 * Normalize Uint8Array-backed data to a plain ArrayBuffer for DOM APIs.
 * @param {Uint8Array} bytes
 * @returns {ArrayBuffer}
 */
function toArrayBuffer(bytes) {
  return new Uint8Array(bytes).buffer;
}

/**
 * @param {Uint8Array} srcBytes
 * @returns {Promise<HTMLImageElement>}
 */
async function bytesToImage(srcBytes) {
  return new Promise((resolve, reject) => {
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
  });
}

/**
 * @param {Uint8Array} srcBytes
 * @param {number} [maxDim]
 * @param {number} [quality]
 * @returns {Promise<Uint8Array>}
 */
async function makeJpegThumbnailBytes(srcBytes, maxDim = MAX_DIMENSION, quality = JPEG_QUALITY) {
  // Canvas fallback used if the native Tauri path is unavailable.
  try {
    const { ImagePool } = await import('@squoosh/lib');
    const pool = new ImagePool(1);
    const image = pool.ingestImage(srcBytes);

    // Resize to fit within maxDim x maxDim, preserving aspect ratio (no upscaling)
    await image.preprocess({
      resize: { width: maxDim, height: maxDim, method: 'lanczos3', premultiply: true, linearRGB: true }
    }).catch(() => {});

    await image.encode({ mozjpeg: { quality } });
    const encoded = /** @type {{ mozjpeg: Promise<{ binary: ArrayBufferLike }> }} */ (image.encodedWith);
    const { binary } = await encoded.mozjpeg;
    await pool.close();
    return new Uint8Array(binary);
  } catch (err) {
    // Fallback to simple Canvas-based thumbnail (kept intentionally straightforward)
    const img = await bytesToImage(srcBytes);
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) throw new Error('Invalid image dimensions');

    // Compute target size, preserving aspect ratio, no upscale
    const scale = Math.min(maxDim / iw, maxDim / ih, 1);
    const tw = Math.max(1, Math.round(iw * scale));
    const th = Math.max(1, Math.round(ih * scale));

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');

    // Fill white to flatten any transparency before drawing
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, tw, th);

    const blob = await new Promise(
      /** @returns {void} */
      (resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality / 100)
    );
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }
}

/**
 * @param {string} filePath
 * @param {string} hex
 * @returns {Promise<string>}
 */
export async function uploadThumbnail(filePath, hex) {
  let thumbBytes;
  try {
    const nativeThumbBytes = await invoke('generate_thumbnail', {
      path: filePath,
      maxDimension: MAX_DIMENSION,
      qualityHint: JPEG_QUALITY
    });
    thumbBytes = Uint8Array.from(/** @type {number[]} */ (nativeThumbBytes));
  } catch {
    const srcBytes = await readFile(filePath);
    thumbBytes = await makeJpegThumbnailBytes(srcBytes, MAX_DIMENSION, JPEG_QUALITY);
  }

  const signResponse = await fetch(buildApiUrl("/uploads/sign"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": WRITE_API_KEY
    },
    body: JSON.stringify({
      path: "thumbnails",
      id: hex,
      ext: "jpeg"
    })
  });

  if (!signResponse.ok) {
    throw new Error(`Failed to request thumbnail upload URL: ${signResponse.status}`);
  }

  const uploadTarget = await signResponse.json();

  const res = await fetch(uploadTarget.uploadUrl, {
    method: 'PUT',
    body: new Blob([toArrayBuffer(thumbBytes)], { type: 'image/jpeg' }),
    headers: uploadTarget.headers || { 'Content-Type': 'image/jpeg' }
  });

  if (!res.ok) {
    throw new Error(`S3 thumbnail upload via presigned URL failed with status ${res.status}`);
  }
  console.log('Thumbnail Upload Success via presigned URL');
  return hex;
}
