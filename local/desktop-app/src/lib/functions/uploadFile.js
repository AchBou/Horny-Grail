import { readFile } from '@tauri-apps/plugin-fs';
import CryptoJS from 'crypto-js';
import { API_BASE_URL, WRITE_API_KEY, buildApiUrl } from "../config/apiEnv.js";

/**
 * @typedef {{ uploadUrl: string, key: string, headers?: Record<string, string> }} UploadTarget
 */

/**
 * @param {string} path
 * @param {string} id
 * @param {string} ext
 * @returns {Promise<UploadTarget>}
 */
async function requestUploadTarget(path, id, ext) {
    const response = await fetch(buildApiUrl("/uploads/sign"), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": WRITE_API_KEY
        },
        body: JSON.stringify({
            path,
            id,
            ext
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to request upload URL: ${response.status}`);
    }

    return response.json();
}

/**
 * @param {string} id
 * @param {string} ext
 * @returns {Promise<void>}
 */
async function registerUploadedFile(id, ext) {
    const response = await fetch(API_BASE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": WRITE_API_KEY
        },
        body: JSON.stringify({
            id,
            ext
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to register uploaded file: ${response.status}`);
    }
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function uploadFile(filePath) {
    // Read the file as binary data
    const fileData = await readFile(filePath);
    
    // Convert the binary data to a format that can be hashed
    const wordArray = CryptoJS.lib.WordArray.create(fileData);
    
    // Create SHA-256 hash
    const hash = CryptoJS.SHA256(wordArray);
    const hex = hash.toString(CryptoJS.enc.Hex);
    
    // Get file extension
    const fileExtension = filePath.split('.').pop()?.toLowerCase() || 'bin';
    
    try {
        const uploadTarget = await requestUploadTarget("files", hex, fileExtension);

        // Upload file using the presigned URL
        const res = await fetch(uploadTarget.uploadUrl, {
            method: 'PUT',
            body: fileData,
            headers: uploadTarget.headers || {}
        });

        if (!res.ok) {
            throw new Error(`S3 upload via presigned URL failed with status ${res.status}`);
        }
        console.log("Upload Success via presigned URL");
        
        await registerUploadedFile(hex, fileExtension);
        
        return hex;
    } catch (err) {
        console.error("Error", err);
        throw err;
    }
}
