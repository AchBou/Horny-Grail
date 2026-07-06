import { buildApiUrl, WRITE_API_KEY } from "../config/apiEnv.js";
import { httpFetch } from "../config/httpClient.js";

/**
 * @typedef {{
 *   id: string,
 *   metadataExists: boolean,
 *   originalExists: boolean,
 *   thumbnailExists: boolean,
 *   repairRequired: boolean,
 *   missing: string[]
 * }} AssetIntegrity
 */

/**
 * @param {string} hex
 * @returns {Promise<AssetIntegrity | null>}
 */
export async function checkAssetIntegrityByHex(hex) {
  if (!hex) return null;

  try {
    const response = await httpFetch(buildApiUrl(`/assets/${hex}/integrity`), {
      headers: {
        "x-api-key": WRITE_API_KEY
      }
    });
    if (!response.ok) {
      throw new Error(`Integrity request failed with status ${response.status}`);
    }
    return response.json();
  } catch (error) {
    console.error("checkAssetIntegrityByHex error", error);
    return null;
  }
}
