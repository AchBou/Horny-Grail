import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getBucketName, getBucketRegion, getLookupTableName } from '../config/env.mjs';
import { findMissingAssets, originalObjectKey, thumbnailObjectKey } from './s3-objects.mjs';

// Deleting from the Grail is undoable for this long. The upload bucket keeps replaced or
// deleted file versions for 30 days (lifecycle rule) and the item row expires through
// DynamoDB TTL on `expiresAt` at the same time.
export const RESTORE_WINDOW_DAYS = 30;
export const DELETED_STATUS = 'deleted';
const ACTIVE_STATUS = 'active';
const INDEX_NAME = 'RandomImageIndex';
const PREVIEW_URL_TTL_SECONDS = 900;

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
let s3Client;
function s3() {
  s3Client ||= new S3Client({ region: getBucketRegion() });
  return s3Client;
}

export function isDeleted(item) {
  return item?.status === DELETED_STATUS;
}

function itemKeys(item) {
  const keys = [thumbnailObjectKey(item.id)];
  if (typeof item.ext === 'string' && item.ext) keys.unshift(originalObjectKey(item.id, item.ext));
  return keys;
}

/**
 * Hides an item everywhere, then deletes its files. With versioning on, S3 keeps the old
 * versions behind a delete marker, so restoreItem can bring them back. The row is hidden
 * first: if deleting a file fails, nothing shows an item with missing files.
 */
export async function softDeleteItem(item, now = new Date()) {
  const deletedAt = now.toISOString();
  const expiresAt = Math.floor(now.getTime() / 1000) + RESTORE_WINDOW_DAYS * 24 * 60 * 60;

  await ddbDocClient.send(new UpdateCommand({
    TableName: getLookupTableName(),
    Key: { id: item.id },
    ConditionExpression: 'attribute_exists(#id)',
    UpdateExpression: 'SET #status = :deleted, #deletedAt = :deletedAt, #expiresAt = :expiresAt',
    ExpressionAttributeNames: { '#id': 'id', '#status': 'status', '#deletedAt': 'deletedAt', '#expiresAt': 'expiresAt' },
    ExpressionAttributeValues: { ':deleted': DELETED_STATUS, ':deletedAt': deletedAt, ':expiresAt': expiresAt }
  }));

  await Promise.all(itemKeys(item).map((key) => s3().send(new DeleteObjectCommand({ Bucket: getBucketName(), Key: key }))));

  return { deletedAt, restorableUntil: new Date(expiresAt * 1000).toISOString() };
}

/** The versions of one key, newest first. */
async function listKeyVersions(key) {
  const result = await s3().send(new ListObjectVersionsCommand({ Bucket: getBucketName(), Prefix: key }));
  const versions = (result.Versions || []).filter((v) => v.Key === key).map((v) => ({ ...v, isDeleteMarker: false }));
  const markers = (result.DeleteMarkers || []).filter((m) => m.Key === key).map((m) => ({ ...m, isDeleteMarker: true }));
  return [...versions, ...markers].sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
}

/** Removes the delete markers sitting on top of a key, which makes its last version current again. */
async function undeleteKey(key) {
  for (const version of await listKeyVersions(key)) {
    if (!version.isDeleteMarker) break;
    await s3().send(new DeleteObjectCommand({ Bucket: getBucketName(), Key: key, VersionId: version.VersionId }));
  }
}

/**
 * Brings a deleted item back: its files first, then the row. Returns the missing parts
 * instead when the old file versions are already gone, and changes nothing in that case.
 */
export async function restoreItem(item) {
  await Promise.all(itemKeys(item).map(undeleteKey));

  const missing = await findMissingAssets(item.id, item.ext || null);
  if (missing.length > 0) {
    return { restored: false, missing };
  }

  await reactivateItem(item.id);
  return { restored: true, missing: [] };
}

/** Marks a deleted row active again (files must already be back). */
export async function reactivateItem(id, tags = null) {
  const names = { '#status': 'status', '#deletedAt': 'deletedAt', '#expiresAt': 'expiresAt' };
  const values = { ':active': ACTIVE_STATUS, ':deleted': DELETED_STATUS };
  let update = 'SET #status = :active';
  if (tags) {
    names['#tags'] = 'tags';
    values[':tags'] = tags;
    update += ', #tags = :tags';
  }
  await ddbDocClient.send(new UpdateCommand({
    TableName: getLookupTableName(),
    Key: { id },
    ConditionExpression: '#status = :deleted',
    UpdateExpression: `${update} REMOVE #deletedAt, #expiresAt`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values
  }));
}

/** A short-lived link to the last version of a deleted item's thumbnail, for the Deleted view. */
async function previousThumbnailUrl(id) {
  const key = thumbnailObjectKey(id);
  const previous = (await listKeyVersions(key)).find((version) => !version.isDeleteMarker);
  if (!previous) return null;
  return getSignedUrl(s3(), new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    VersionId: previous.VersionId
  }), { expiresIn: PREVIEW_URL_TTL_SECONDS });
}

/** Deleted items that can still be restored, most recently deleted first. */
export async function listDeletedItems() {
  const items = [];
  let startKey;
  do {
    const page = await ddbDocClient.send(new QueryCommand({
      TableName: getLookupTableName(),
      IndexName: INDEX_NAME,
      KeyConditionExpression: '#status = :deleted',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':deleted': DELETED_STATUS },
      ExclusiveStartKey: startKey
    }));
    items.push(...(page.Items || []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const restorable = items
    .filter((item) => !item.expiresAt || item.expiresAt > nowSeconds)
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));

  return Promise.all(restorable.map(async (item) => ({
    id: item.id,
    ext: item.ext,
    tags: Array.isArray(item.tags) ? item.tags : [],
    deletedAt: item.deletedAt || null,
    restorableUntil: item.expiresAt ? new Date(item.expiresAt * 1000).toISOString() : null,
    thumbnailUrl: await previousThumbnailUrl(item.id).catch(() => null)
  })));
}
