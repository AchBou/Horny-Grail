import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../config/env.mjs';
import { requireWriteAccess } from '../lib/auth.mjs';
import { badRequest, conflict, jsonResponse, serverError } from '../lib/http.mjs';
import { guardRequest } from '../lib/request-guards.mjs';
import { findMissingAssets } from '../lib/s3-objects.mjs';
import { isValidImageExt, isValidImageId, parseJsonBody } from '../lib/validation.mjs';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function getExistingItem(id) {
  const existing = await ddbDocClient.send(new GetCommand({
    TableName: getLookupTableName(),
    Key: { id }
  }));
  return existing.Item || null;
}

function respondWithExisting(existing, ext, event) {
  if (existing.ext !== ext) {
    return badRequest('Image id is already registered with a different extension', event);
  }
  return jsonResponse(200, existing, event);
}

/**
 * Registers metadata for an uploaded file. New items are only written once both the
 * original and the thumbnail are in S3, so browse never lists an item with missing files.
 * Re-registering an existing item returns it unchanged (clients retry and repair this way).
 */
export const putItemHandler = async (event) => {
  const requestPath = event?.requestContext?.http?.path || event?.path || '/api/';
  const guardError = guardRequest(event, {
    handlerName: 'putItem',
    method: 'POST',
    allowOptions: true,
    authorize: requireWriteAccess
  });
  if (guardError) {
    return guardError;
  }

  const body = parseJsonBody(event);
  if (!body) {
    return badRequest('Invalid JSON body', event);
  }

  const { id, ext } = body;

  if (!isValidImageId(id)) {
    return badRequest('Invalid image id', event);
  }

  if (!isValidImageExt(ext)) {
    return badRequest('Invalid image extension', event);
  }

  try {
    const existing = await getExistingItem(id);
    if (existing) {
      return respondWithExisting(existing, ext, event);
    }

    const missing = await findMissingAssets(id, ext);
    if (missing.length > 0) {
      console.warn('putItem refused: uploads missing', { path: requestPath, id, ext, missing });
      return conflict('Upload the original and thumbnail before registering the item', event, { missing });
    }
  } catch (error) {
    console.error('putItem pre-checks failed', { path: requestPath, id, error });
    return serverError('Failed to write item', event);
  }

  // Metadata is immutable after creation so retries cannot change browse order or extension.
  const item = {
    id,
    ext,
    date: body.date || new Date().toISOString(),
    status: 'active',
    randomKey: Math.random()
  };

  try {
    await ddbDocClient.send(new PutCommand({
      TableName: getLookupTableName(),
      Item: item,
      ConditionExpression: 'attribute_not_exists(#id)',
      ExpressionAttributeNames: { '#id': 'id' }
    }));
    console.info('putItem succeeded', { path: requestPath, id, ext });
  } catch (err) {
    if (err?.name !== 'ConditionalCheckFailedException') {
      console.error('putItem failed', { path: requestPath, id, ext, error: err });
      return serverError('Failed to write item', event);
    }

    // Another request registered the same id between our read and write.
    try {
      const existing = await getExistingItem(id);
      return existing
        ? respondWithExisting(existing, ext, event)
        : serverError('Failed to resolve existing item', event);
    } catch (lookupError) {
      console.error('Failed to resolve existing item', { path: requestPath, id, error: lookupError });
      return serverError('Failed to resolve existing item', event);
    }
  }

  return jsonResponse(200, item, event);
};
