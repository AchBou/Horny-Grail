import { PutObjectCommand } from "@aws-sdk/client-s3";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { s3Client } from "../config/s3Client.js";
import { ddbClient } from "../config/dynamodbClient.js";
import { BUCKET_NAME, DYNAMO_TABLE } from "../config/awsEnv.js";
import { readFile } from '@tauri-apps/plugin-fs';
import CryptoJS from 'crypto-js';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
    const fileExtension = filePath.split('.').pop() || 'bin';
    
    // S3 object key
    const key = 'files/' + hex + '.' + fileExtension;

    // Prepare parameters for DynamoDB
    const logInDBParams = {
        Item: {
            id: {
                S: hex
            },
            ext: {
                S: fileExtension
            },
            date: {
                S: new Date().toString()
            }
        },
        TableName: DYNAMO_TABLE
    };

    try {
        // Generate a presigned URL for S3 PUT operation
        const command = new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key });
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15 minutes

        // Upload file using the presigned URL
        const res = await fetch(presignedUrl, {
            method: 'PUT',
            body: fileData,
            // Note: Do not set Content-Type unless it was included when signing
        });

        if (!res.ok) {
            throw new Error(`S3 upload via presigned URL failed with status ${res.status}`);
        }
        console.log("Upload Success via presigned URL");
        
        // Log in DynamoDB
        const ddbCommand = new PutItemCommand(logInDBParams);
        await ddbClient.send(ddbCommand);
        
        return hex;
    } catch (err) {
        console.error("Error", err);
        throw err;
    }
}
