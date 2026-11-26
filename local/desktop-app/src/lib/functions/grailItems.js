import { buildApiUrl, WRITE_API_KEY } from "../config/apiEnv.js";
import { httpFetch } from "../config/httpClient.js";

/**
 * @param {string} hex
 * @returns {Promise<{ id: string, metadataDeleted: boolean }>}
 */
export async function purgeAssetMetadata(hex) {
  const response = await httpFetch(buildApiUrl(`/assets/${hex}`), {
    method: "DELETE",
    headers: {
      "x-api-key": WRITE_API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`Purge request failed with status ${response.status}`);
  }

  return response.json();
}
