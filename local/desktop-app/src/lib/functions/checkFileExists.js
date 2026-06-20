import { buildApiUrl } from "../config/apiEnv.js";
import { httpFetch } from "../config/httpClient.js";

// Check if an item with primary key id === hex exists in DynamoDB
/**
 * @param {string} hex
 * @returns {Promise<boolean>}
 */
export async function checkFileExistsByHex(hex) {
  if (!hex) return false;

  try {
    const response = await httpFetch(buildApiUrl(`/${hex}`));
    if (!response.ok) {
      throw new Error(`Metadata request failed with status ${response.status}`);
    }

    const item = await response.json();
    return !!(item && item.id);
  } catch (e) {
    console.error("checkFileExistsByHex error", e);
    // Fail-open (assume it doesn't exist) to avoid blocking uploads due to transient errors
    return false;
  }
}
