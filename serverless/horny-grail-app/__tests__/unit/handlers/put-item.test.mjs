import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { jest } from '@jest/globals';
import { putItemHandler } from '../../../src/handlers/put-item.mjs';

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

  it.each(['webm', 'mp4'])('should accept %s items', async (ext) => {
    const id = 'e'.repeat(64);

    const result = await register({ id, ext });

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({ id, ext }));
  });
});
