import { jest } from '@jest/globals';

const mockedGetSignedUrl = jest.fn();

jest.unstable_mockModule('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockedGetSignedUrl
}));

const { signUploadHandler } = await import('../../../src/handlers/uploads/sign-upload.mjs');

describe('Test signUploadHandler', () => {
  beforeEach(() => {
    mockedGetSignedUrl.mockReset();
    mockedGetSignedUrl.mockResolvedValue('https://example.com/upload');
  });

  it('should issue a signed URL for file uploads', async () => {
    const id = 'c'.repeat(64);
    const result = await signUploadHandler({
      httpMethod: 'POST',
      headers: {
        'x-api-key': 'test-write-api-key'
      },
      body: JSON.stringify({
        path: 'files',
        id,
        ext: 'png'
      })
    });

    expect(result.statusCode).toEqual(200);
    const body = JSON.parse(result.body);
    expect(body.uploadUrl).toEqual('https://example.com/upload');
    expect(body.key).toEqual(`files/${id}.png`);
  });

  it('should issue a signed URL for webm uploads', async () => {
    const id = 'd'.repeat(64);
    const result = await signUploadHandler({
      httpMethod: 'POST',
      headers: {
        'x-api-key': 'test-write-api-key'
      },
      body: JSON.stringify({
        path: 'files',
        id,
        ext: 'webm'
      })
    });

    expect(result.statusCode).toEqual(200);
    const body = JSON.parse(result.body);
    expect(body.key).toEqual(`files/${id}.webm`);
  });

  it('should reject unauthorized requests', async () => {
    const result = await signUploadHandler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        path: 'files',
        id: 'c'.repeat(64),
        ext: 'png'
      })
    });

    expect(result.statusCode).toEqual(401);
  });

  it('should reject invalid upload targets', async () => {
    const result = await signUploadHandler({
      httpMethod: 'POST',
      headers: {
        'x-api-key': 'test-write-api-key'
      },
      body: JSON.stringify({
        path: 'elsewhere',
        id: 'bad',
        ext: 'exe'
      })
    });

    expect(result.statusCode).toEqual(400);
  });
});
