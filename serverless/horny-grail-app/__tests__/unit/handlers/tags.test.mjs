import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { getDesktopRandomBrowseHandler, getRandomBrowseHandler } from '../../../src/handlers/browse/get-random-browse.mjs';
import { listDesktopTagsHandler, listMobileTagsHandler } from '../../../src/handlers/tags/list-tags.mjs';
import { updateTagsHandler } from '../../../src/handlers/tags/update-tags.mjs';
import { issueMobileReadToken } from '../../../src/lib/auth.mjs';
import { resetActiveItemsCache } from '../../../src/lib/random-browse.mjs';

const id = 'c'.repeat(64);
const writeKey = { 'x-api-key': 'test-write-api-key' };

function patchTags(body, headers = writeKey, itemId = id) {
  return updateTagsHandler({
    httpMethod: 'PATCH',
    headers,
    pathParameters: { id: itemId },
    body: JSON.stringify(body)
  });
}

describe('tag routes', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);

  beforeEach(() => {
    ddbMock.reset();
    resetActiveItemsCache();
  });

  describe('PATCH /api/assets/{id}/tags', () => {
    it('adds and removes tags and returns the result', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { id, ext: 'jpg', tags: ['beach', 'old'] } });
      ddbMock.on(UpdateCommand).resolves({});

      const result = await patchTags({ add: ['Sun'], remove: ['old'] });

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ id, tags: ['beach', 'sun'] });
      const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(update.UpdateExpression).toBe('SET #tags = :tags');
      expect(update.ExpressionAttributeValues).toEqual({ ':tags': ['beach', 'sun'] });
      expect(update.ConditionExpression).toBe('attribute_exists(#id)');
    });

    it('removes the attribute when the last tag goes', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { id, ext: 'jpg', tags: ['beach'] } });
      ddbMock.on(UpdateCommand).resolves({});

      const result = await patchTags({ remove: ['beach'] });

      expect(JSON.parse(result.body).tags).toEqual([]);
      expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input.UpdateExpression).toBe('REMOVE #tags');
    });

    it('writes nothing when the tags do not change', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { id, ext: 'jpg', tags: ['beach'] } });

      const result = await patchTags({ add: ['beach'] });

      expect(result.statusCode).toBe(200);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('only accepts the desktop write key, not a phone session', async () => {
      const { token } = await issueMobileReadToken();

      const result = await patchTags({ add: ['x'] }, { authorization: `Bearer ${token}` });

      expect(result.statusCode).toBe(401);
      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    });

    it('rejects bad tags, bad ids and unknown items', async () => {
      ddbMock.on(GetCommand).resolves({});

      expect((await patchTags({ add: ['no,commas'] })).statusCode).toBe(400);
      expect((await patchTags({ add: 'beach' })).statusCode).toBe(400);
      expect((await patchTags({ add: ['x'] }, writeKey, 'nope')).statusCode).toBe(400);
      expect((await patchTags({ add: ['x'] })).statusCode).toBe(404);
    });

    it('caps the number of tags on one item', async () => {
      const many = Array.from({ length: 30 }, (_, index) => `tag${index}`);
      ddbMock.on(GetCommand).resolves({ Item: { id, ext: 'jpg', tags: many } });

      expect((await patchTags({ add: ['one more'] })).statusCode).toBe(400);
    });
  });

  describe('tag lists and filtered browse', () => {
    const hex = (n) => n.toString(16).padStart(64, '0');
    const items = [
      { id: hex(1), ext: 'jpg', status: 'active', tags: ['beach', 'sun'] },
      { id: hex(2), ext: 'jpg', status: 'active', tags: ['beach'] },
      { id: hex(3), ext: 'mp4', status: 'active' }
    ];

    beforeEach(() => {
      ddbMock.on(QueryCommand).resolves({ Items: items });
    });

    it('lists tags with counts for the phone and the desktop', async () => {
      const { token } = await issueMobileReadToken();
      const mobile = await listMobileTagsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${token}` } });
      const desktop = await listDesktopTagsHandler({ httpMethod: 'GET', headers: writeKey });

      const expected = {
        tags: [{ tag: 'beach', count: 2 }, { tag: 'sun', count: 1 }],
        total: 3,
        untagged: 1
      };
      expect(JSON.parse(mobile.body)).toEqual(expected);
      expect(JSON.parse(desktop.body)).toEqual(expected);
    });

    it('does not list tags without credentials', async () => {
      expect((await listDesktopTagsHandler({ httpMethod: 'GET', headers: {} })).statusCode).toBe(401);
      expect((await listMobileTagsHandler({ httpMethod: 'GET', headers: writeKey })).statusCode).toBe(401);
    });

    async function browseIds(queryStringParameters) {
      const result = await getRandomBrowseHandler({
        httpMethod: 'GET',
        headers: { 'x-read-origin-secret': process.env.READ_ORIGIN_SECRET },
        queryStringParameters
      });
      expect(result.statusCode).toBe(200);
      return JSON.parse(result.body).items.map((item) => item.id).sort();
    }

    it('filters browse by tags or untagged', async () => {
      expect(await browseIds({ tags: 'beach' })).toEqual([hex(1), hex(2)]);
      expect(await browseIds({ tags: 'beach,sun' })).toEqual([hex(1)]);
      expect(await browseIds({ untagged: '1' })).toEqual([hex(3)]);
      expect(await browseIds({})).toHaveLength(3);
    });

    it('rejects an invalid tag filter', async () => {
      const result = await getRandomBrowseHandler({
        httpMethod: 'GET',
        headers: { 'x-read-origin-secret': process.env.READ_ORIGIN_SECRET },
        queryStringParameters: { tags: 'beach', untagged: '1' }
      });
      expect(result.statusCode).toBe(400);
    });

    it('serves the desktop feed with signed URLs and tags, for the write key only', async () => {
      const result = await getDesktopRandomBrowseHandler({ httpMethod: 'GET', headers: writeKey, queryStringParameters: { tags: 'sun' } });
      const [item] = JSON.parse(result.body).items;

      expect(item).toEqual(expect.objectContaining({ id: hex(1), tags: ['beach', 'sun'] }));
      expect(item.fileUrl).toContain(`files/${hex(1)}.jpg`);
      expect(item.thumbnailUrl).toContain(`thumbnails/thumbnail-${hex(1)}.jpeg`);

      const denied = await getDesktopRandomBrowseHandler({ httpMethod: 'GET', headers: {} });
      expect(denied.statusCode).toBe(401);
    });
  });
});
