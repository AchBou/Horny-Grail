import { mockClient } from 'aws-sdk-client-mock';
import { DeleteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

const { deleteAssetHandler } = await import('../../../src/handlers/assets/delete-asset.mjs');

describe('Test deleteAssetHandler', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('should delete existing metadata entries', async () => {
    const id = 'd'.repeat(64);
    ddbMock.on(DeleteCommand).resolves({
      Attributes: { id, ext: 'webm' }
    });

    const result = await deleteAssetHandler({
      httpMethod: 'DELETE',
      headers: {
        'x-api-key': process.env.WRITE_API_KEY
      },
      pathParameters: { id }
    });

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body)).toEqual({
      id,
      metadataDeleted: true
    });
  });

  it('should be idempotent when metadata is already missing', async () => {
    const id = 'e'.repeat(64);
    ddbMock.on(DeleteCommand).resolves({});

    const result = await deleteAssetHandler({
      httpMethod: 'DELETE',
      headers: {
        'x-api-key': process.env.WRITE_API_KEY
      },
      pathParameters: { id }
    });

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body)).toEqual({
      id,
      metadataDeleted: false
    });
  });

  it('should reject invalid ids', async () => {
    const result = await deleteAssetHandler({
      httpMethod: 'DELETE',
      headers: {
        'x-api-key': process.env.WRITE_API_KEY
      },
      pathParameters: { id: 'bad' }
    });

    expect(result.statusCode).toEqual(400);
    expect(JSON.parse(result.body)).toEqual({
      code: 'bad_request',
      message: 'Invalid image id'
    });
  });

  it('should reject unauthorized requests', async () => {
    const id = 'f'.repeat(64);

    const result = await deleteAssetHandler({
      httpMethod: 'DELETE',
      headers: {
        'x-api-key': 'wrong-key'
      },
      pathParameters: { id }
    });

    expect(result.statusCode).toEqual(401);
    expect(JSON.parse(result.body)).toEqual({
      code: 'unauthorized',
      message: 'Unauthorized'
    });
  });
});
