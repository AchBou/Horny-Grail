import { createMobileSessionHandler } from '../../../src/handlers/auth/create-mobile-session.mjs';

describe('Test createMobileSessionHandler', () => {
  it('should issue a bearer token for a valid access code', async () => {
    const result = await createMobileSessionHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        code: process.env.READ_ACCESS_CODE
      })
    });

    expect(result.statusCode).toEqual(200);
    const body = JSON.parse(result.body);
    expect(typeof body.token).toEqual('string');
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('should reject an invalid access code', async () => {
    const result = await createMobileSessionHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        code: 'wrong-code'
      })
    });

    expect(result.statusCode).toEqual(401);
    expect(JSON.parse(result.body)).toEqual({
      code: 'unauthorized',
      message: 'Unauthorized'
    });
  });
});
