import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { getRandomBrowseHandler } from '../../../src/handlers/browse/get-random-browse.mjs';

const hexId = (index) => index.toString(16).padStart(64, '0');
const makeItems = (count) => Array.from({ length: count }, (_, index) => ({
  id: hexId(index + 1), ext: 'jpg', status: 'active', randomKey: index / count
}));
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function browse(queryStringParameters) {
  return getRandomBrowseHandler({
    httpMethod: 'GET',
    headers: { 'x-read-origin-secret': process.env.READ_ORIGIN_SECRET },
    queryStringParameters
  });
}

async function browseAll(limit) {
  const pages = [];
  let cursor;
  do {
    const result = await browse(cursor ? { limit: String(limit), cursor } : { limit: String(limit) });
    expect(result.statusCode).toEqual(200);
    const body = JSON.parse(result.body);
    pages.push(body);
    cursor = body.cursor;
  } while (cursor);
  return pages;
}

describe('Test getRandomBrowseHandler', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);

  beforeEach(() => {
    ddbMock.reset();
  });

  it('should read every active item from the random index, following pagination', async () => {
    const items = makeItems(3);
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: items.slice(0, 2), LastEvaluatedKey: { id: items[1].id } })
      .resolvesOnce({ Items: items.slice(2) });

    const body = JSON.parse((await browse({ limit: '10' })).body);

    expect(body.items).toHaveLength(3);
    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0].input).toEqual(expect.objectContaining({
      IndexName: 'RandomImageIndex',
      KeyConditionExpression: '#status = :status'
    }));
    expect(calls[1].args[0].input.ExclusiveStartKey).toEqual({ id: items[1].id });
  });

  it('should visit every item exactly once across pages', async () => {
    const items = makeItems(25);
    ddbMock.on(QueryCommand).resolves({ Items: items });

    const pages = await browseAll(7);
    const seen = pages.flatMap((page) => page.items.map((item) => item.id));

    expect(pages).toHaveLength(4);
    expect(new Set(seen).size).toEqual(25);
    expect(seen).toHaveLength(25);
    expect(pages.at(-1)).toEqual(expect.objectContaining({ hasMore: false, cursor: null }));
    expect(new Set(pages.map((page) => page.seed)).size).toEqual(1);
  });

  it('should shuffle differently per session instead of replaying one fixed order', async () => {
    const items = makeItems(30);
    ddbMock.on(QueryCommand).resolves({ Items: items });

    const orders = new Set();
    for (let session = 0; session < 5; session += 1) {
      const body = JSON.parse((await browse({ limit: '30' })).body);
      orders.add(body.items.map((item) => item.id).join(','));
    }

    // With the old randomKey walk, every session was a rotation of the same cycle.
    expect(orders.size).toEqual(5);
  });

  it('should not repeat or skip items when an item is added mid-session', async () => {
    const items = makeItems(20);
    ddbMock.on(QueryCommand).resolves({ Items: items });
    const first = JSON.parse((await browse({ limit: '10' })).body);

    const added = { id: hexId(999), ext: 'png', status: 'active', randomKey: 0.5 };
    ddbMock.on(QueryCommand).resolves({ Items: [...items, added] });
    const rest = [];
    let cursor = first.cursor;
    while (cursor) {
      const body = JSON.parse((await browse({ limit: '10', cursor })).body);
      rest.push(...body.items);
      cursor = body.cursor;
    }

    const seen = [...first.items, ...rest].map((item) => item.id);
    expect(new Set(seen).size).toEqual(seen.length);
    expect(seen.filter((id) => id !== added.id)).toHaveLength(20);
  });

  it('should restart with a new shuffle for a cursor in the old format', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: makeItems(3) });

    const result = await browse({
      limit: '10',
      cursor: encode({ seed: 0.75, segment: 'after', startKey: { id: hexId(1) } })
    });

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body).items).toHaveLength(3);
  });

  it.each([
    ['not base64 json', 'bad-value'],
    ['a json array', encode([1, 2])],
    ['a bad seed', encode({ seed: 'zz', after: '0'.repeat(80) })],
    ['a missing position', encode({ seed: '0'.repeat(16) })],
    ['a tampered position', encode({ seed: '0'.repeat(16), after: { id: { S: 'x' } } })],
    ['an oversized cursor', 'a'.repeat(600)]
  ])('should return 400 for %s', async (_label, cursor) => {
    const result = await browse({ cursor });

    expect(result.statusCode).toEqual(400);
    expect(JSON.parse(result.body)).toEqual({ code: 'bad_request', message: 'Invalid cursor' });
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
});
