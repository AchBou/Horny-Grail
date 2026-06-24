import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { jest } from '@jest/globals';
import { getRandomBrowseHandler } from '../../../src/handlers/browse/get-random-browse.mjs';

describe('Test getRandomBrowseHandler', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);

  beforeEach(() => {
    ddbMock.reset();
    jest.spyOn(Math, 'random').mockReturnValue(0.75);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return the first random browse page', async () => {
    const items = [{ id: 'a'.repeat(64), ext: 'jpg', status: 'active', randomKey: 0.8 }];
    ddbMock.on(QueryCommand).resolves({
      Items: items,
      LastEvaluatedKey: { id: items[0].id, status: 'active', randomKey: 0.8 }
    });

    const result = await getRandomBrowseHandler({
      httpMethod: 'GET',
      queryStringParameters: { limit: '1' }
    });

    expect(result.statusCode).toEqual(200);

    const body = JSON.parse(result.body);
    expect(body.items).toEqual(items);
    expect(body.seed).toEqual(0.75);
    expect(body.wrapped).toEqual(false);
    expect(body.hasMore).toEqual(true);
    expect(typeof body.cursor).toEqual('string');
  });

  it('should continue from the encoded cursor', async () => {
    const cursor = Buffer.from(JSON.stringify({
      seed: 0.75,
      segment: 'after',
      startKey: { id: 'a'.repeat(64), status: 'active', randomKey: 0.8 }
    })).toString('base64url');

    ddbMock.on(QueryCommand).resolves({
      Items: [{ id: 'b'.repeat(64), ext: 'png', status: 'active', randomKey: 0.81 }],
      LastEvaluatedKey: null
    });

    const result = await getRandomBrowseHandler({
      httpMethod: 'GET',
      queryStringParameters: { cursor, limit: '1' }
    });

    const query = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(query.ExclusiveStartKey).toEqual({
      id: 'a'.repeat(64),
      status: 'active',
      randomKey: 0.8
    });
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
      hasMore: false,
      wrapped: false
    }));
  });

  it('should wrap around and fill the page from the lower random segment', async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [{ id: 'c'.repeat(64), ext: 'jpg', status: 'active', randomKey: 0.95 }],
        LastEvaluatedKey: null
      })
      .resolvesOnce({
        Items: [{ id: 'd'.repeat(64), ext: 'webm', status: 'active', randomKey: 0.1 }],
        LastEvaluatedKey: { id: 'd'.repeat(64), status: 'active', randomKey: 0.1 }
      });

    const result = await getRandomBrowseHandler({
      httpMethod: 'GET',
      queryStringParameters: { limit: '2' }
    });

    const body = JSON.parse(result.body);
    expect(body.items).toEqual([
      { id: 'c'.repeat(64), ext: 'jpg', status: 'active', randomKey: 0.95 },
      { id: 'd'.repeat(64), ext: 'webm', status: 'active', randomKey: 0.1 }
    ]);
    expect(body.wrapped).toEqual(true);
    expect(body.hasMore).toEqual(true);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.KeyConditionExpression).toContain('randomKey >= :seed');
    expect(calls[1].args[0].input.KeyConditionExpression).toContain('randomKey < :seed');
  });

  it('should return hasMore false when the wrapped segment is exhausted', async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [], LastEvaluatedKey: null })
      .resolvesOnce({ Items: [{ id: 'e'.repeat(64), ext: 'png', status: 'active', randomKey: 0.2 }], LastEvaluatedKey: null });

    const result = await getRandomBrowseHandler({
      httpMethod: 'GET',
      queryStringParameters: { limit: '2' }
    });

    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
      hasMore: false,
      wrapped: true,
      cursor: null
    }));
  });

  it('should reject invalid cursors', async () => {
    const result = await getRandomBrowseHandler({
      httpMethod: 'GET',
      queryStringParameters: { cursor: 'bad-value' }
    });

    expect(result.statusCode).toEqual(400);
    expect(JSON.parse(result.body)).toEqual({
      code: 'bad_request',
      message: 'Invalid cursor'
    });
  });
});
