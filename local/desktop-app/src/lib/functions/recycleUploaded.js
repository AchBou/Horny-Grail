import { invoke } from "@tauri-apps/api/core";
import { checkAssetIntegrityByHex } from "./checkAssetIntegrity.js";
import { confirmStoredFiles } from "./uploadSafety.js";

/**
 * Moves uploaded files to the Recycle Bin, but only those the server confirms right now.
 * The Rust side then re-hashes each file and only moves it if it still matches and sits
 * directly in the synced folder.
 * @param {string} folder the synced folder
 * @param {{ path: string, name: string, hash: string }[]} files
 * @returns {Promise<{ moved: string[], errors: string[] }>}
 */
export async function moveUploadedToRecycleBin(folder, files) {
  const { confirmed, errors } = await confirmStoredFiles(files, checkAssetIntegrityByHex);
  if (confirmed.length === 0) {
    return { moved: [], errors };
  }

  /** @type {{ moved: string[], errors: string[] }} */
  const result = await invoke("move_uploaded_to_recycle_bin", {
    folder,
    files: confirmed.map((file) => ({ path: file.path, hash: file.hash }))
  });
  return { moved: result.moved, errors: [...errors, ...result.errors] };
}
