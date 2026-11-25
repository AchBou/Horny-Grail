import { invoke } from "@tauri-apps/api/core";

// Small preview frames for local videos in the upload list, made by the bundled ffmpeg.
// Only a couple run at once so scrolling a big folder stays smooth, and each frame is kept
// for the session (keyed by path and modified time, so an edited file gets a new frame).
const MAX_RUNNING = 2;
const PREVIEW_SIZE = 112;

/** @type {Map<string, Promise<string>>} */
const cache = new Map();
/** @type {(() => void)[]} */
const waiting = [];
let running = 0;

async function withSlot(/** @type {() => Promise<string>} */ work) {
  if (running >= MAX_RUNNING) {
    await new Promise((resolve) => waiting.push(() => resolve(undefined)));
  }
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/**
 * Returns an object URL for a preview frame of a local video.
 * @param {string} path
 * @param {number} modifiedAt
 * @returns {Promise<string>}
 */
export function requestVideoPreview(path, modifiedAt = 0) {
  const key = `${path}|${modifiedAt}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = withSlot(async () => {
      /** @type {number[]} */
      const bytes = await invoke("generate_video_thumbnail", {
        path,
        maxDimension: PREVIEW_SIZE,
        qualityHint: 75
      });
      return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
    });
    // A failed frame (corrupt video) is not retried during the session.
    cache.set(key, pending);
  }
  return pending;
}
