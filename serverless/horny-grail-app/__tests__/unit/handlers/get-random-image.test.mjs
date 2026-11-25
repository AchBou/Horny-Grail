import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { getRandomImageHandler } from '../../../src/handlers/images/get-random-image.mjs';

function getRandom() {
  return getRandomImageHandler({
    httpMethod: 'GET',
    headers: { 'x-read-origin-secret': process.env.READ_ORIGIN_SECRET }
  });
}

describe('Test getRandomImageHandler', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);

  beforeEach(() => {
    ddbMock.reset();
  });

  it('should return an active image from the random index', async () => {
    const id = 'a'.repeat(64);
    ddbMock.on(QueryCommand).resolves({ Items: [{ id, ext: 'jpg', status: 'active', randomKey: 0.8 }] });

    const result = await getRandom();

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body)).toEqual({ id, ext: 'jpg' });
    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input).toEqual(expect.objectContaining({
      TableName: 'horny-grail-name-lookup',
      IndexName: 'RandomImageIndex',
      KeyConditionExpression: '#status = :status'
    }));
  });

  it('should pick items evenly regardless of gaps between their random keys', async () => {
    // Under the old "first key above a random point" rule, the item after the big gap
    // (0.01 -> 0.99) would win about 98% of the time.
    const items = [
      { id: 'a'.repeat(64), ext: 'jpg', randomKey: 0 },
      { id: 'b'.repeat(64), ext: 'jpg', randomKey: 0.01 },
      { id: 'c'.repeat(64), ext: 'jpg', randomKey: 0.99 }
    ];
    ddbMock.on(QueryCommand).resolves({ Items: items });

    const counts = {};
    for (let draw = 0; draw < 300; draw += 1) {
      const { id } = JSON.parse((await getRandom()).body);
      counts[id] = (counts[id] || 0) + 1;
    }

    for (const item of items) {
      expect(counts[item.id]).toBeGreaterThan(50);
    }
  });

  it('should return 404 when there are no active images', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const result = await getRandom();

    expect(result.statusCode).toEqual(404);
    expect(JSON.parse(result.body)).toEqual({ code: 'not_found', message: 'No active images found' });
  });

  it('should reject non-GET methods', async () => {
    const result = await getRandomImageHandler({ httpMethod: 'POST' });

    expect(result.statusCode).toEqual(405);
  });
});
