// Create clients and set shared const values outside of the handler.

// Create a DocumentClient that represents the query to add an item
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
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

    // Metadata is immutable after creation so retries cannot change browse order or extension.
    const item = {
        id,
        ext,
        date: body.date || new Date().toISOString(),
        status: 'active',
        randomKey: Math.random()
    };
    const params = {
        TableName : getLookupTableName(),
        Item: item,
        ConditionExpression: 'attribute_not_exists(#id)',
        ExpressionAttributeNames: { '#id': 'id' }
    };

    try {
        await ddbDocClient.send(new PutCommand(params));
        console.info('putItem succeeded', { path: requestPath, id, ext });
      } catch (err) {
        if (err?.name === 'ConditionalCheckFailedException') {
          try {
            const existing = await ddbDocClient.send(new GetCommand({
              TableName: getLookupTableName(),
              Key: { id }
            }));
            if (!existing.Item) {
              return serverError('Failed to resolve existing item', event);
            }
            if (existing.Item.ext !== ext) {
              return badRequest('Image id is already registered with a different extension', event);
            }
            return jsonResponse(200, existing.Item, event);
          } catch (lookupError) {
            console.error('Failed to resolve existing item', { path: requestPath, id, error: lookupError });
            return serverError('Failed to resolve existing item', event);
          }
        }
        console.error('putItem failed', { path: requestPath, id, ext, error: err });
        return serverError('Failed to write item', event);
      }

    const response = jsonResponse(200, item, event);

    console.info('putItem response', { path: requestPath, statusCode: response.statusCode, id, ext });
    return response;
};
