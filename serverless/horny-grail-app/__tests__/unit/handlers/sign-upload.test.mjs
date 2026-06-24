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
        ext: 'png',
        contentType: 'image/png',
        sizeBytes: 12345
      })
    });

    expect(result.statusCode).toEqual(200);
    const body = JSON.parse(result.body);
    expect(body.uploadUrl).toEqual('https://example.com/upload');
    expect(body.key).toEqual(`files/${id}.png`);
    expect(body.headers).toEqual({
      'Content-Type': 'image/png'
    });
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
        ext: 'webm',
        contentType: 'video/webm',
        sizeBytes: 98765
      })
    });

    expect(result.statusCode).toEqual(200);
    const body = JSON.parse(result.body);
    expect(body.key).toEqual(`files/${id}.webm`);
  });

  it('should issue a signed URL for thumbnail uploads', async () => {
    const id = 'e'.repeat(64);
    const result = await signUploadHandler({
      httpMethod: 'POST',
      headers: {
        'x-api-key': 'test-write-api-key'
      },
      body: JSON.stringify({
        path: 'thumbnails',
        id,
        ext: 'jpeg',
        contentType: 'image/jpeg',
        sizeBytes: 2048
      })
    });

    expect(result.statusCode).toEqual(200);
    const body = JSON.parse(result.body);
    expect(body.key).toEqual(`thumbnails/thumbnail-${id}.jpeg`);
    expect(body.headers).toEqual({
      'Content-Type': 'image/jpeg'
    });
  });

  it('should reject unauthorized requests', async () => {
    const result = await signUploadHandler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        path: 'files',
        id: 'c'.repeat(64),
        ext: 'png',
        contentType: 'image/png',
        sizeBytes: 12345
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

  it('should reject file uploads with a mismatched content type', async () => {
    const result = await signUploadHandler({
      httpMethod: 'POST',
      headers: {
        'x-api-key': 'test-write-api-key'
      },
      body: JSON.stringify({
        path: 'files',
        id: 'c'.repeat(64),
        ext: 'png',
        contentType: 'image/jpeg',
        sizeBytes: 12345
      })
    });

    expect(result.statusCode).toEqual(400);
  });

  it('should reject oversized original uploads', async () => {
    const result = await signUploadHandler({
      httpMethod: 'POST',
      headers: {
        'x-api-key': 'test-write-api-key'
      },
      body: JSON.stringify({
        path: 'files',
        id: 'c'.repeat(64),
        ext: 'webm',
        contentType: 'video/webm',
        sizeBytes: 100 * 1024 * 1024 + 1
      })
    });

    expect(result.statusCode).toEqual(400);
  });
});
