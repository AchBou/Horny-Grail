import { DeleteObjectCommand, HeadObjectCommand, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import {
  deleteAssetHandler,
  listDeletedAssetsHandler,
  restoreAssetHandler
} from '../../../src/handlers/assets/delete-asset.mjs';
import { issueMobileReadToken } from '../../../src/lib/auth.mjs';

const id = 'd'.repeat(64);
const writeKey = { 'x-api-key': process.env.WRITE_API_KEY };
const notFound = () => Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });

const call = (handler, method, headers = writeKey) => handler({ httpMethod: method, headers, pathParameters: { id } });

describe('delete from the Grail', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    ddbMock.on(UpdateCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    s3Mock.on(HeadObjectCommand).resolves({});
  });

  describe('DELETE /api/assets/{id}', () => {
    it('hides the item, sets a 30-day expiry and deletes both files', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { id, ext: 'webm', status: 'active', tags: ['beach'] } });

      const result = await call(deleteAssetHandler, 'DELETE');

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toEqual(expect.objectContaining({ id, deleted: true }));
      const days = (new Date(body.restorableUntil) - new Date(body.deletedAt)) / 86400000;
      expect(Math.round(days)).toBe(30);

      const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(update.ExpressionAttributeValues[':deleted']).toBe('deleted');
      expect(update.ConditionExpression).toBe('attribute_exists(#id)');
      const keys = s3Mock.commandCalls(DeleteObjectCommand).map((c) => c.args[0].input.Key).sort();
      expect(keys).toEqual([`files/${id}.webm`, `thumbnails/thumbnail-${id}.jpeg`]);
    });

    it('hides the item before touching files, so a failed file delete never shows a broken item', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { id, ext: 'jpg', status: 'active' } });
      s3Mock.on(DeleteObjectCommand).rejects(new Error('S3 down'));

      const result = await call(deleteAssetHandler, 'DELETE');

      expect(result.statusCode).toBe(500);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    });

    it('does nothing for an item that does not exist or is already deleted', async () => {
      ddbMock.on(GetCommand).resolvesOnce({}).resolves({ Item: { id, ext: 'jpg', status: 'deleted', deletedAt: 'x', expiresAt: 2000000000 } });

      expect(JSON.parse((await call(deleteAssetHandler, 'DELETE')).body)).toEqual({ id, deleted: false });
      expect(JSON.parse((await call(deleteAssetHandler, 'DELETE')).body).deleted).toBe(true);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
      expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    });

    it('only accepts the desktop write key', async () => {
      const { token } = await issueMobileReadToken();

      expect((await call(deleteAssetHandler, 'DELETE', { authorization: `Bearer ${token}` })).statusCode).toBe(401);
      expect((await call(deleteAssetHandler, 'DELETE', {})).statusCode).toBe(401);
      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    });
  });

  describe('POST /api/assets/{id}/restore', () => {
    const deletedItem = { id, ext: 'jpg', status: 'deleted', deletedAt: '2026-11-01T00:00:00Z', expiresAt: 2000000000, tags: ['sun'] };

    function versionsWithMarker(key) {
      return {
        Versions: [{ Key: key, VersionId: 'v1', LastModified: new Date('2026-10-01') }],
        DeleteMarkers: [{ Key: key, VersionId: 'marker', LastModified: new Date('2026-11-01'), IsLatest: true }]
      };
    }

    it('removes the delete markers and makes the item active again', async () => {
      ddbMock.on(GetCommand).resolves({ Item: deletedItem });
      s3Mock.on(ListObjectVersionsCommand).callsFake((input) => versionsWithMarker(input.Prefix));

      const result = await call(restoreAssetHandler, 'POST');

      expect(result.statusCode).toBe(200);
      const removed = s3Mock.commandCalls(DeleteObjectCommand).map((c) => c.args[0].input);
      expect(removed.every((input) => input.VersionId === 'marker')).toBe(true);
      expect(removed.map((input) => input.Key).sort()).toEqual([`files/${id}.jpg`, `thumbnails/thumbnail-${id}.jpeg`]);
      const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(update.UpdateExpression).toContain('REMOVE #deletedAt, #expiresAt');
      expect(update.ConditionExpression).toBe('#status = :deleted');
    });

    it('refuses and changes nothing when the old files are gone', async () => {
      ddbMock.on(GetCommand).resolves({ Item: deletedItem });
      s3Mock.on(ListObjectVersionsCommand).resolves({});
      s3Mock.on(HeadObjectCommand).rejects(notFound());

      const result = await call(restoreAssetHandler, 'POST');

      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).missing).toEqual(['original', 'thumbnail']);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('reports items that are gone for good', async () => {
      ddbMock.on(GetCommand).resolves({});

      expect((await call(restoreAssetHandler, 'POST')).statusCode).toBe(404);
    });
  });

  describe('GET /api/desktop/deleted', () => {
    it('lists restorable deleted items, newest first, with a preview of the old thumbnail', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { id: 'a'.repeat(64), ext: 'jpg', status: 'deleted', deletedAt: '2026-11-01T00:00:00Z', expiresAt: 4000000000 },
          { id: 'b'.repeat(64), ext: 'mp4', status: 'deleted', deletedAt: '2026-11-20T00:00:00Z', expiresAt: 4000000000, tags: ['x'] },
          { id: 'c'.repeat(64), ext: 'jpg', status: 'deleted', deletedAt: '2026-09-01T00:00:00Z', expiresAt: 1000 }
        ]
      });
      s3Mock.on(ListObjectVersionsCommand).callsFake((input) => ({
        Versions: [{ Key: input.Prefix, VersionId: 'old', LastModified: new Date('2026-10-01') }],
        DeleteMarkers: [{ Key: input.Prefix, VersionId: 'm', LastModified: new Date('2026-11-01') }]
      }));

      const result = await listDeletedAssetsHandler({ httpMethod: 'GET', headers: writeKey });
      const { items } = JSON.parse(result.body);

      expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.ExpressionAttributeValues).toEqual({ ':deleted': 'deleted' });
      expect(items.map((item) => item.id)).toEqual(['b'.repeat(64), 'a'.repeat(64)]);
      expect(items[0].tags).toEqual(['x']);
      expect(items[0].thumbnailUrl).toContain('versionId=old');
    });
  });
});
