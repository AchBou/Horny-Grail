import { jest } from '@jest/globals';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

const s3Mock = mockClient(S3Client);
const ddbMock = mockClient(DynamoDBDocumentClient);

const { getAssetIntegrityHandler } = await import('../../../src/handlers/assets/get-asset-integrity.mjs');

describe('Test getAssetIntegrityHandler', () => {
  beforeEach(() => {
    s3Mock.reset();
    ddbMock.reset();
  });

  it('should report a healthy asset when original and thumbnail both exist', async () => {
    const id = 'a'.repeat(64);
    ddbMock.on(GetCommand).resolves({
      Item: { id, ext: 'jpg' }
    });
    s3Mock.on(HeadObjectCommand).resolves({});

    const result = await getAssetIntegrityHandler({
      httpMethod: 'GET',
      headers: {
        'x-api-key': process.env.WRITE_API_KEY
      },
      pathParameters: { id }
    });

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
      id,
      metadataExists: true,
      originalExists: true,
      thumbnailExists: true,
      repairRequired: false,
      missing: []
    }));
  });

  it('should report repair required when the thumbnail is missing', async () => {
    const id = 'b'.repeat(64);
    ddbMock.on(GetCommand).resolves({
      Item: { id, ext: 'png' }
    });
    s3Mock.on(HeadObjectCommand, {
      Bucket: process.env.BUCKET_NAME,
      Key: `files/${id}.png`
    }).resolves({});
    s3Mock.on(HeadObjectCommand, {
      Bucket: process.env.BUCKET_NAME,
      Key: `thumbnails/thumbnail-${id}.jpeg`
    }).rejects({
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 }
    });

    const result = await getAssetIntegrityHandler({
      httpMethod: 'GET',
      headers: {
        'x-api-key': process.env.WRITE_API_KEY
      },
      pathParameters: { id }
    });

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
      id,
      metadataExists: true,
      originalExists: true,
      thumbnailExists: false,
      repairRequired: true,
      missing: ['thumbnail']
    }));
  });

  it('should report missing metadata without requiring repair', async () => {
    const id = 'c'.repeat(64);
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await getAssetIntegrityHandler({
      httpMethod: 'GET',
      headers: {
        'x-api-key': process.env.WRITE_API_KEY
      },
      pathParameters: { id }
    });

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body)).toEqual({
      id,
      metadataExists: false,
      originalExists: false,
      thumbnailExists: false,
      repairRequired: false,
      missing: []
    });
  });

  it('should reject invalid ids', async () => {
    const result = await getAssetIntegrityHandler({
      httpMethod: 'GET',
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
});
