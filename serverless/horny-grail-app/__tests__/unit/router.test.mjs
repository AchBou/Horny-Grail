import { jest } from '@jest/globals';
import { createRouter } from '../../src/lib/router.mjs';

describe('createRouter', () => {
  it('should dispatch by HTTP API route key', async () => {
    const getById = jest.fn(async () => ({ statusCode: 200, body: 'by-id' }));
    const list = jest.fn(async () => ({ statusCode: 200, body: 'list' }));
    const handler = createRouter({ 'GET /api/{id}': getById, 'GET /api': list });
    const event = { routeKey: 'GET /api/{id}', pathParameters: { id: 'x' } };

    const result = await handler(event);

    expect(result.body).toBe('by-id');
    expect(getById).toHaveBeenCalledWith(event);
    expect(list).not.toHaveBeenCalled();
  });

  it('should return 404 for an unknown route', async () => {
    const handler = createRouter({ 'GET /api': jest.fn() });

    const result = await handler({ routeKey: 'GET /nope' });

    expect(result.statusCode).toBe(404);
  });
});
