import { invoke } from "@tauri-apps/api/core";
import { checkAssetIntegrityByHex } from "./checkAssetIntegrity.js";

/**
 * True when the server has the item and both of its files. The original's upload was
 * checksum-verified against its hash, so a stored original holds exactly these bytes.
 * @param {import("./checkAssetIntegrity.js").AssetIntegrity | null} integrity
 */
export function isSafelyStored(integrity) {
  return Boolean(
    integrity?.metadataExists &&
    integrity.originalExists &&
    integrity.thumbnailExists &&
    !integrity.repairRequired
  );
}

/**
 * Moves uploaded files to the Recycle Bin, but only those the server confirms right now.
 * The Rust side then re-hashes each file and only moves it if it still matches and sits
 * directly in the synced folder.
 * @param {string} folder the synced folder
 * @param {{ path: string, name: string, hash: string }[]} files
 * @returns {Promise<{ moved: string[], errors: string[] }>}
 */
export async function moveUploadedToRecycleBin(folder, files) {
  /** @type {{ path: string, hash: string }[]} */
  const confirmed = [];
  /** @type {string[]} */
  const errors = [];

  for (const file of files) {
    const integrity = await checkAssetIntegrityByHex(file.hash);
    if (isSafelyStored(integrity)) {
      confirmed.push({ path: file.path, hash: file.hash });
    } else {
      errors.push(`${file.name}: not confirmed in the Grail, kept on this PC`);
    }
  }

  if (confirmed.length === 0) {
    return { moved: [], errors };
  }

  /** @type {{ moved: string[], errors: string[] }} */
  const result = await invoke("move_uploaded_to_recycle_bin", { folder, files: confirmed });
  return { moved: result.moved, errors: [...errors, ...result.errors] };
}
