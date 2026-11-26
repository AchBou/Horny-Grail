import { buildApiUrl, WRITE_API_KEY } from "../config/apiEnv.js";
import { httpFetch } from "../config/httpClient.js";

/**
 * Deletes an item from the Grail. It disappears from every app at once and stays
 * restorable for 30 days (restoreToGrail).
 * @param {string} hex
 * @returns {Promise<{ id: string, deleted: boolean, deletedAt?: string, restorableUntil?: string }>}
 */
export async function deleteFromGrail(hex) {
  const response = await httpFetch(buildApiUrl(`/assets/${hex}`), {
    method: "DELETE",
    headers: {
      "x-api-key": WRITE_API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`Delete request failed with status ${response.status}`);
  }

  return response.json();
}

/**
 * Undoes a delete while the old files still exist (up to 30 days).
 * @param {string} hex
 * @returns {Promise<void>}
 */
export async function restoreToGrail(hex) {
  const response = await httpFetch(buildApiUrl(`/assets/${hex}/restore`), {
    method: "POST",
    headers: {
      "x-api-key": WRITE_API_KEY
    }
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json())?.message || "";
    } catch {
      // keep the status code only
    }
    throw new Error(detail || `Restore failed with status ${response.status}`);
  }
}

/**
 * @typedef {{ id: string, ext: string, tags: string[], deletedAt: string | null, restorableUntil: string | null, thumbnailUrl: string | null }} DeletedItem
 */

/** @returns {Promise<DeletedItem[]>} deleted items that can still be restored, newest first */
export async function fetchDeletedItems() {
  const response = await httpFetch(buildApiUrl("/desktop/deleted"), {
    headers: {
      "x-api-key": WRITE_API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`Loading deleted items failed with status ${response.status}`);
  }

  return (await response.json()).items;
}
