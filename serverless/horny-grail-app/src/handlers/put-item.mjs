// Create clients and set shared const values outside of the handler.

// Create a DocumentClient that represents the query to add an item
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../config/env.mjs';
import { requireWriteApiKey } from '../lib/auth.mjs';
import { badRequest, jsonResponse, serverError } from '../lib/http.mjs';
import { guardRequest } from '../lib/request-guards.mjs';
import { isValidImageExt, isValidImageId, parseJsonBody } from '../lib/validation.mjs';
const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

/**
 * A simple example includes a HTTP post method to add one item to a DynamoDB table.
 */
export const putItemHandler = async (event) => {
    const requestPath = event?.requestContext?.http?.path || event?.path || '/api/';
    const guardError = guardRequest(event, {
        handlerName: 'putItem',
        method: 'POST',
        allowOptions: true,
        authorize: requireWriteApiKey
    });
    if (guardError) {
        return guardError;
    }

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
        await ddbDocClient.send(new PutCommand(params));
        console.info('putItem succeeded', { path: requestPath, id, ext });
      } catch (err) {
        console.error('putItem failed', { path: requestPath, id, ext, error: err });
        return serverError('Failed to write item', event);
      }

    const response = jsonResponse(200, params.Item, event);

    console.info('putItem response', { path: requestPath, statusCode: response.statusCode, id, ext });
    return response;
};
