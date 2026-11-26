import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { getAssetIntegrityHandler } from '../../../src/handlers/assets/get-asset-integrity.mjs';
import { getByIdHandler, getMobileByIdHandler } from '../../../src/handlers/get-by-id.mjs';
import { issueMobileReadToken } from '../../../src/lib/auth.mjs';

const id = 'f'.repeat(64);
const deleted = { id, ext: 'jpg', status: 'deleted', deletedAt: '2026-11-20T00:00:00Z', expiresAt: 2000000000 };

describe('items deleted from the Grail are gone for every app', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    ddbMock.on(GetCommand).resolves({ Item: deleted });
    s3Mock.on(HeadObjectCommand).resolves({});
  });

  it('the website gets "not found" (null)', async () => {
    const result = await getByIdHandler({
      httpMethod: 'GET',
      headers: { 'x-read-origin-secret': process.env.READ_ORIGIN_SECRET },
      pathParameters: { id }
    });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toBeNull();
  });

  it('the phone gets 404', async () => {
    const { token } = await issueMobileReadToken();
    const result = await getMobileByIdHandler({
      httpMethod: 'GET',
      headers: { authorization: `Bearer ${token}` },
      pathParameters: { id }
    });
    expect(result.statusCode).toBe(404);
  });

  it('upload clients see it as absent, so uploading it again brings it back', async () => {
    const result = await getAssetIntegrityHandler({
      httpMethod: 'GET',
      headers: { 'x-api-key': process.env.WRITE_API_KEY },
      pathParameters: { id }
    });
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({ metadataExists: false, repairRequired: false }));
  });
});
