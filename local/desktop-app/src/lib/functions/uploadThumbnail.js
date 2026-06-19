import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "../config/s3Client.js";
import { readFile } from '@tauri-apps/plugin-fs';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BUCKET_NAME } from "../config/awsEnv.js";

// Rollback to simple JS thumbnail generation (max 150px, JPEG)
const MAX_DIMENSION = 150;
const JPEG_QUALITY = 0.85; // 0..1

async function bytesToImage(srcBytes) {
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([srcBytes]);
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

async function makeJpegThumbnailBytes(srcBytes, maxDim = MAX_DIMENSION, quality = JPEG_QUALITY) {
  // Prefer high-quality resize/encode via @squoosh/lib when available
  try {
    const { ImagePool } = await import('@squoosh/lib');
    const pool = new ImagePool(1);
    const image = pool.ingestImage(srcBytes);

    // Resize to fit within maxDim x maxDim, preserving aspect ratio (no upscaling)
    await image.preprocess({
      resize: { width: maxDim, height: maxDim, method: 'lanczos3', premultiply: true, linearRGB: true }
    }).catch(() => {});

    await image.encode({ mozjpeg: { quality: Math.round(quality * 100) } });
    const { binary } = await image.encodedWith.mozjpeg;
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
    ctx.drawImage(img, 0, 0, tw, th);

    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality)
    );
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }
}

export async function uploadThumbnail(filePath, hex) {
  // Read original image bytes
  const srcBytes = await readFile(filePath);
  // Create small JPEG thumbnail (150px max side)
  const thumbBytes = await makeJpegThumbnailBytes(srcBytes, MAX_DIMENSION, JPEG_QUALITY);

  // Upload to S3 via presigned URL
  const key = 'thumbnails/thumbnail-' + hex + '.jpeg';
  const command = new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, ContentType: 'image/jpeg' });
  const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

  const res = await fetch(presignedUrl, {
    method: 'PUT',
    body: thumbBytes,
    headers: { 'Content-Type': 'image/jpeg' }
  });

  if (!res.ok) {
    throw new Error(`S3 thumbnail upload via presigned URL failed with status ${res.status}`);
  }
  console.log('Thumbnail Upload Success via presigned URL');
  return hex;
}