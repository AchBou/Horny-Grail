import { invoke } from '@tauri-apps/api/core';

/**
 * SHA-256 hex of a file, streamed in Rust (`compute_sha256_streaming`) off the main thread,
 * so even very large files never pass through JavaScript memory.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function computeFileHash(filePath) {
  const hex = await invoke('compute_sha256_streaming', { path: filePath });
  if (typeof hex !== 'string' || !/^[a-f0-9]{64}$/.test(hex)) {
    throw new Error(`Unexpected hash result for ${filePath}`);
  }
  return hex;
}
