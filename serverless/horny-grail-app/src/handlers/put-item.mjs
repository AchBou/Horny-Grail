import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../config/env.mjs';
import { hasWriteApiKey, requireWriteAccess } from '../lib/auth.mjs';
import { setItemTags } from '../lib/items-repository.mjs';
import { applyTagChange, itemTags, MAX_TAGS_PER_ITEM, parseTagList } from '../lib/tags.mjs';
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

/** Returns an existing item, first adding any requested tags it does not have yet. */
async function respondWithExisting(existing, ext, tags, event) {
  if (existing.ext !== ext) {
    return badRequest('Image id is already registered with a different extension', event);
  }
  const current = itemTags(existing);
  const merged = applyTagChange(current, { add: tags });
  if (merged.length === current.length) {
    return jsonResponse(200, existing, event);
  }
  if (merged.length > MAX_TAGS_PER_ITEM) {
    return badRequest(`An item can have at most ${MAX_TAGS_PER_ITEM} tags`, event);
  }
  await setItemTags(existing.id, merged);
  return jsonResponse(200, { ...existing, tags: merged }, event);
}

/**
 * Registers metadata for an uploaded file. New items are only written once both the
 * original and the thumbnail are in S3, so browse never lists an item with missing files.
 * Re-registering an existing item returns it unchanged (clients retry and repair this way).
 */
export const putItemHandler = async (event) => {
  const requestPath = event?.requestContext?.http?.path || event?.path || '/api/';
  const guardError = await guardRequest(event, {
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

  // Tags come from the desktop uploader only; the phone does not tag.
  const tags = parseTagList(body.tags, MAX_TAGS_PER_ITEM);
  if (!tags) {
    return badRequest('Invalid tags: use letters, digits, spaces, "-" or "_", up to 32 characters each', event);
  }
  if (tags.length > 0 && !(await hasWriteApiKey(event))) {
    return badRequest('Tags can only be set from the desktop app', event);
  }

  try {
    const existing = await getExistingItem(id);
    if (existing) {
      return await respondWithExisting(existing, ext, tags, event);
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
  // Tags are the exception: they only grow here and change through the tags route.
  const item = {
    id,
    ext,
    date: body.date || new Date().toISOString(),
    status: 'active',
    randomKey: Math.random(),
    ...(tags.length > 0 ? { tags: applyTagChange([], { add: tags }) } : {})
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
        ? await respondWithExisting(existing, ext, tags, event)
        : serverError('Failed to resolve existing item', event);
    } catch (lookupError) {
      console.error('Failed to resolve existing item', { path: requestPath, id, error: lookupError });
      return serverError('Failed to resolve existing item', event);
    }
  }

  return jsonResponse(200, item, event);
};
