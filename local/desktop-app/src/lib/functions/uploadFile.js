import { readFile } from '@tauri-apps/plugin-fs';
import { API_BASE_URL, WRITE_API_KEY, buildApiUrl } from "../config/apiEnv.js";
import { computeFileHash } from "./computeFileHash.js";
import { httpFetch } from "../config/httpClient.js";

/** @type {Record<string, string>} */
const MIME_BY_EXT = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    webm: "video/webm",
    mp4: "video/mp4"
};

/**
 * @typedef {{ uploadUrl: string, key: string, headers?: Record<string, string> }} UploadTarget
 */

/**
 * @param {string} path
 * @param {string} id
 * @param {string} ext
 * @param {number} sizeBytes
 * @param {string} contentType
 * @returns {Promise<UploadTarget>}
 */
async function requestUploadTarget(path, id, ext, sizeBytes, contentType) {
    const response = await httpFetch(buildApiUrl("/uploads/sign"), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": WRITE_API_KEY
        },
        body: JSON.stringify({
            path,
            id,
            ext,
            sizeBytes,
            contentType
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to request upload URL: ${response.status}`);
    }

    return response.json();
}

/**
 * Registers an uploaded file. Tags go on a new item, or are added to one already saved.
 * @param {string} id
 * @param {string} ext
 * @param {string[]} [tags]
 * @returns {Promise<void>}
 */
export async function registerUploadedFile(id, ext, tags = []) {
    const response = await httpFetch(API_BASE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": WRITE_API_KEY
        },
        body: JSON.stringify({
            id,
            ext,
            ...(tags.length > 0 ? { tags } : {})
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to register uploaded file: ${response.status}`);
    }
}

/**
 * @param {string} filePath
 * @param {string} [knownHash]
 * @param {{registerMetadata?: boolean}} [options]
 * @returns {Promise<string>}
 */
export async function uploadFile(filePath, knownHash, { registerMetadata = true } = {}) {
    // Hash in Rust unless the caller already has it.
    const suppliedHash = typeof knownHash === 'string' ? knownHash.toLowerCase() : '';
    const hex = /^[a-f0-9]{64}$/.test(suppliedHash) ? suppliedHash : await computeFileHash(filePath);

    const fileData = await readFile(filePath);

    // Get file extension
    const fileExtension = filePath.split('.').pop()?.toLowerCase() || 'bin';
    const contentType = MIME_BY_EXT[fileExtension];
    if (!contentType) {
        throw new Error(`Unsupported upload extension: ${fileExtension}`);
    }
    
    try {
        const uploadTarget = await requestUploadTarget("files", hex, fileExtension, fileData.byteLength, contentType);

        // Upload file using the presigned URL
        const res = await httpFetch(uploadTarget.uploadUrl, {
            method: 'PUT',
            body: fileData,
            headers: uploadTarget.headers || {}
        });

        if (!res.ok) {
            throw new Error(`S3 upload via presigned URL failed with status ${res.status}`);
        }
        console.log("Upload Success via presigned URL");
        
        if (registerMetadata) {
            await registerUploadedFile(hex, fileExtension);
        }
        
        return hex;
    } catch (err) {
        console.error("Error", err);
        throw err;
    }
}
