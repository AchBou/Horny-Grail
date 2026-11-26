import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { jest } from '@jest/globals';
import { putItemHandler } from '../../../src/handlers/put-item.mjs';
import { issueMobileReadToken } from '../../../src/lib/auth.mjs';

const notFoundError = () => Object.assign(new Error('NotFound'), {
  name: 'NotFound',
  $metadata: { httpStatusCode: 404 }
});

function register(body, headers = { 'x-api-key': 'test-write-api-key' }) {
  return putItemHandler({ httpMethod: 'POST', headers, body: JSON.stringify(body) });
}

describe('Test putItemHandler', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    s3Mock.on(HeadObjectCommand).resolves({});
    jest.spyOn(Math, 'random').mockReturnValue(0.42);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should add the item once the original and thumbnail are in S3', async () => {
    const id = 'b'.repeat(64);

    const result = await register({ id, ext: 'jpg' });

    expect(result.statusCode).toEqual(200);
    expect(result.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
      id, ext: 'jpg', status: 'active', randomKey: 0.42
    }));
    const heads = s3Mock.commandCalls(HeadObjectCommand).map((call) => call.args[0].input);
    expect(heads).toEqual(expect.arrayContaining([
      { Bucket: 'test-upload-bucket', Key: `files/${id}.jpg` },
      { Bucket: 'test-upload-bucket', Key: `thumbnails/thumbnail-${id}.jpeg` }
    ]));
    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.ConditionExpression)
      .toBe('attribute_not_exists(#id)');
  });

  it.each([
    ['thumbnail', 'thumbnails/'],
    ['original', 'files/']
  ])('should return 409 and write nothing when the %s is missing', async (part, prefix) => {
    const id = 'd'.repeat(64);
    s3Mock.on(HeadObjectCommand, { Key: prefix === 'files/' ? `files/${id}.png` : `thumbnails/thumbnail-${id}.jpeg` })
      .rejects(notFoundError());

    const result = await register({ id, ext: 'png' });

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body)).toEqual({
      code: 'conflict',
      message: 'Upload the original and thumbnail before registering the item',
      missing: [part]
    });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should list both parts when nothing was uploaded', async () => {
    s3Mock.on(HeadObjectCommand).rejects(notFoundError());

    const result = await register({ id: 'd'.repeat(64), ext: 'jpg' });

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).missing).toEqual(['original', 'thumbnail']);
  });

  it('should return 500 and write nothing when S3 cannot be checked', async () => {
    s3Mock.on(HeadObjectCommand).rejects(Object.assign(new Error('AccessDenied'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 }
    }));

    const result = await register({ id: 'd'.repeat(64), ext: 'jpg' });

    expect(result.statusCode).toBe(500);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should return an existing item unchanged without checking S3 (retries and repairs)', async () => {
    const id = 'a'.repeat(64);
    const existing = { id, ext: 'jpg', date: '2025-01-01T00:00:00.000Z', status: 'active', randomKey: 0.11 };
    ddbMock.on(GetCommand).resolves({ Item: existing });
    s3Mock.on(HeadObjectCommand).rejects(notFoundError());

    const result = await register({ id, ext: 'jpg', date: '2030-01-01T00:00:00.000Z' });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(existing);
    expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should reject a duplicate id registered with a different extension', async () => {
    const id = 'c'.repeat(64);
    ddbMock.on(GetCommand).resolves({ Item: { id, ext: 'jpg' } });

    const result = await register({ id, ext: 'png' });

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toBe('Image id is already registered with a different extension');
  });

  it('should return the winner when another request registers the same id first', async () => {
    const id = 'a'.repeat(64);
    const winner = { id, ext: 'jpg', status: 'active', randomKey: 0.9 };
    ddbMock.on(GetCommand).resolvesOnce({}).resolves({ Item: winner });
    ddbMock.on(PutCommand).rejects(Object.assign(new Error('already exists'), {
      name: 'ConditionalCheckFailedException'
    }));

    const result = await register({ id, ext: 'jpg' });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(winner);
  });

  it('should reject missing api key', async () => {
    const result = await register({ id: 'b'.repeat(64), ext: 'jpg' }, {});

    expect(result.statusCode).toEqual(401);
    expect(JSON.parse(result.body)).toEqual({ code: 'unauthorized', message: 'Unauthorized' });
  });

  it('should reject invalid item payloads', async () => {
    const result = await register({ id: 'bad', ext: 'exe' });

    expect(result.statusCode).toEqual(400);
    expect(JSON.parse(result.body)).toEqual({ code: 'bad_request', message: 'Invalid image id' });
  });

  it('should store tags on a new item from the desktop app', async () => {
    const id = 'b'.repeat(64);

    const result = await register({ id, ext: 'jpg', tags: ['Sun', 'beach', 'sun'] });

    expect(result.statusCode).toBe(200);
    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item.tags).toEqual(['beach', 'sun']);
  });

  it('should add tags to an item that is already saved', async () => {
    const id = 'a'.repeat(64);
    ddbMock.on(GetCommand).resolves({ Item: { id, ext: 'jpg', tags: ['beach'] } });
    ddbMock.on(UpdateCommand).resolves({});

    const result = await register({ id, ext: 'jpg', tags: ['sun'] });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).tags).toEqual(['beach', 'sun']);
    expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues)
      .toEqual({ ':tags': ['beach', 'sun'] });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should bring back a deleted item when its files are uploaded again', async () => {
    const id = 'a'.repeat(64);
    ddbMock.on(GetCommand).resolves({
      Item: { id, ext: 'jpg', status: 'deleted', deletedAt: 'x', expiresAt: 2000000000, randomKey: 0.3, tags: ['beach'] }
    });
    ddbMock.on(UpdateCommand).resolves({});

    const result = await register({ id, ext: 'jpg', tags: ['sun'] });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual(expect.objectContaining({ id, status: 'active', randomKey: 0.3, tags: ['beach', 'sun'] }));
    expect(body.deletedAt).toBeUndefined();
    expect(body.expiresAt).toBeUndefined();
    const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(update.ConditionExpression).toBe('#status = :deleted');
    expect(update.UpdateExpression).toContain('REMOVE #deletedAt, #expiresAt');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should not bring back a deleted item before its files are uploaded', async () => {
    const id = 'a'.repeat(64);
    ddbMock.on(GetCommand).resolves({ Item: { id, ext: 'jpg', status: 'deleted' } });
    s3Mock.on(HeadObjectCommand).rejects(notFoundError());

    const result = await register({ id, ext: 'jpg' });

    expect(result.statusCode).toBe(409);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('should refuse tags from a phone session and invalid tags', async () => {
    const { token } = await issueMobileReadToken();
    const fromPhone = await register({ id: 'b'.repeat(64), ext: 'jpg', tags: ['x'] }, { authorization: `Bearer ${token}` });
    const invalid = await register({ id: 'b'.repeat(64), ext: 'jpg', tags: ['no;way'] });

    expect(fromPhone.statusCode).toBe(400);
    expect(invalid.statusCode).toBe(400);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should still let a phone session register without tags', async () => {
    const { token } = await issueMobileReadToken();

    const result = await register({ id: 'b'.repeat(64), ext: 'jpg' }, { authorization: `Bearer ${token}` });

    expect(result.statusCode).toBe(200);
    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item.tags).toBeUndefined();
  });

  it.each(['webm', 'mp4'])('should accept %s items', async (ext) => {
    const id = 'e'.repeat(64);

    const result = await register({ id, ext });

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({ id, ext }));
  });
});
