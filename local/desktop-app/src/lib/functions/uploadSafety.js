// Decisions that keep the Grail the only safe copy, kept free of Tauri and network code so
// they can be tested: what a server integrity answer means for a local file, and which files
// may leave this PC.

/**
 * @typedef {import("./checkAssetIntegrity.js").AssetIntegrity} AssetIntegrity
 */

/**
 * True when the server has the item and both of its files. The original's upload was
 * checksum-verified against its hash, so a stored original holds exactly these bytes.
 * @param {AssetIntegrity | null | undefined} integrity
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
 * What a scan shows for a local file, from the server's integrity answer. An item deleted
 * from the Grail reports no metadata, so its file shows as new and can be uploaded again.
 * @param {AssetIntegrity} integrity
 * @returns {{ exists: boolean, repairNeeded: boolean, missing: string[], tags: string[] }}
 */
export function classifyIntegrity(integrity) {
  const exists = Boolean(integrity?.metadataExists);
  return {
    exists,
    repairNeeded: Boolean(exists && integrity?.repairRequired),
    missing: Array.isArray(integrity?.missing) ? integrity.missing : [],
    tags: Array.isArray(integrity?.item?.tags) ? integrity.item.tags : []
  };
}

/**
 * Asks the server about each file right now and keeps only those it confirms. A failed check
 * (null) counts as not confirmed, so the file stays on the PC.
 * @template {{ path: string, name: string, hash: string }} F
 * @param {F[]} files
 * @param {(hash: string) => Promise<AssetIntegrity | null>} checkIntegrity
 * @returns {Promise<{ confirmed: F[], errors: string[] }>}
 */
export async function confirmStoredFiles(files, checkIntegrity) {
  /** @type {F[]} */
  const confirmed = [];
  /** @type {string[]} */
  const errors = [];
  for (const file of files) {
    const integrity = file.hash ? await checkIntegrity(file.hash) : null;
    if (isSafelyStored(integrity)) confirmed.push(file);
    else errors.push(`${file.name}: not confirmed in the Grail, kept on this PC`);
  }
  return { confirmed, errors };
}
