import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import CryptoJS from 'crypto-js';

// Compute SHA-256 hex hash of a file at filePath using a streaming Tauri command when available,
// falling back to JS hashing if invoking fails for any reason.
export async function computeFileHash(filePath) {
  try {
    const hex = await invoke('compute_sha256_streaming', { path: filePath });
    if (typeof hex === 'string' && hex.length === 64) {
      return hex;
    }
  } catch (e) {
    // Fallback to JS hashing below
  }

  // Fallback: Read entire file (may be memory heavy on very large files)
  const fileData = await readFile(filePath);
  const wordArray = CryptoJS.lib.WordArray.create(fileData);
  const hash = CryptoJS.SHA256(wordArray);
  return hash.toString(CryptoJS.enc.Hex);
}
