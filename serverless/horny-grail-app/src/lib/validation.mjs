const HASH_RE = /^[a-fA-F0-9]{64}$/;
const EXT_RE = /^(jpe?g|png|gif|webp|bmp|tiff?|webm)$/i;

export function isValidImageId(id) {
  return typeof id === 'string' && HASH_RE.test(id);
}

export function isValidImageExt(ext) {
  return typeof ext === 'string' && EXT_RE.test(ext);
}

export function parseJsonBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch {
    return null;
  }
}
