import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { jest } from '@jest/globals';
import { getRandomImageHandler } from '../../../src/handlers/images/get-random-image.mjs';

describe('Test getRandomImageHandler', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);

  beforeEach(() => {
    ddbMock.reset();
    jest.spyOn(Math, 'random').mockReturnValue(0.75);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return an active image from the random index', async () => {
    const id = 'a'.repeat(64);
    ddbMock.on(QueryCommand).resolves({
      Items: [{ id, ext: 'jpg', status: 'active', randomKey: 0.8 }]
    });

    const result = await getRandomImageHandler({
      httpMethod: 'GET',
      headers: {
        'x-read-origin-secret': process.env.READ_ORIGIN_SECRET
      }
    });

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body)).toEqual({
      id,
      ext: 'jpg',
      url: `https://example.cloudfront.net/files/${id}.jpg`
    });

    const query = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(query).toEqual(expect.objectContaining({
      TableName: 'horny-grail-name-lookup',
      IndexName: 'RandomImageIndex',
      KeyConditionExpression: '#status = :status AND randomKey >= :randomKey',
      Limit: 1,
      ScanIndexForward: true
    }));
    expect(query.ExpressionAttributeValues).toEqual({
      ':status': 'active',
      ':randomKey': 0.75
    });
  });

  it('should wrap around to the start of the index when no item exists after the random key', async () => {
    const id = 'b'.repeat(64);
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [] })
      .resolvesOnce({ Items: [{ id, ext: 'png', status: 'active', randomKey: 0.1 }] });

    const result = await getRandomImageHandler({
      httpMethod: 'GET',
      headers: {
        'x-read-origin-secret': process.env.READ_ORIGIN_SECRET
      }
    });

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
      id,
      ext: 'png',
      url: `https://example.cloudfront.net/files/${id}.png`
    }));

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0].input.ExpressionAttributeValues[':randomKey']).toEqual(0.75);
    expect(calls[1].args[0].input.ExpressionAttributeValues[':randomKey']).toEqual(0);
  });

  it('should return 404 when there are no active images', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const result = await getRandomImageHandler({
      httpMethod: 'GET',
      headers: {
        'x-read-origin-secret': process.env.READ_ORIGIN_SECRET
      }
    });

    expect(result.statusCode).toEqual(404);
    expect(JSON.parse(result.body)).toEqual({
      code: 'not_found',
      message: 'No active images found'
    });
  });

  it('should reject non-GET methods', async () => {
    const result = await getRandomImageHandler({ httpMethod: 'POST' });

    expect(result.statusCode).toEqual(405);
  });
});
