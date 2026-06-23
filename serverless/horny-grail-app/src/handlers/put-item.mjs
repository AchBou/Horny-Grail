// Create clients and set shared const values outside of the handler.

// Create a DocumentClient that represents the query to add an item
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../config/env.mjs';
import { requireWriteApiKey } from '../lib/auth.mjs';
import { badRequest, corsPreflight, jsonResponse, methodNotAllowed, serverError } from '../lib/http.mjs';
import { isValidImageExt, isValidImageId, parseJsonBody } from '../lib/validation.mjs';
const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

/**
 * A simple example includes a HTTP post method to add one item to a DynamoDB table.
 */
export const putItemHandler = async (event) => {
    const method = event?.httpMethod || event?.requestContext?.http?.method || '';
    if (method === 'OPTIONS') {
        return corsPreflight(event);
    }

    if (method !== 'POST') {
        return methodNotAllowed(`postMethod only accepts POST method, you tried: ${method} method.`, event);
    }

    const authError = requireWriteApiKey(event);
    if (authError) {
        return authError;
    }

    // All log statements are written to CloudWatch
    console.info('received:', event);

    const body = parseJsonBody(event);
    if (!body) {
        return badRequest('Invalid JSON body', event);
    }

    const id = body.id;
    const ext = body.ext;

    if (!isValidImageId(id)) {
        return badRequest('Invalid image id', event);
    }

    if (!isValidImageExt(ext)) {
        return badRequest('Invalid image extension', event);
    }

    // Creates a new item, or replaces an old item with a new item
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#put-property
    var params = {
        TableName : getLookupTableName(),
        Item: {
            id,
            ext,
            date: body.date || new Date().toISOString(),
            status: 'active',
            randomKey: Math.random()
        }
    };

    try {
        const data = await ddbDocClient.send(new PutCommand(params));
        console.log("Success - item added or updated", data);
      } catch (err) {
        console.error("Error", err);
        return serverError('Failed to write item', event);
      }

    const response = jsonResponse(200, params.Item, event);

    // All log statements are written to CloudWatch
    console.info(`response from: ${event.path} statusCode: ${response.statusCode} body: ${response.body}`);
    return response;
};
