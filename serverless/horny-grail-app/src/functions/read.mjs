import { getMobileRandomBrowseHandler, getRandomBrowseHandler } from '../handlers/browse/get-random-browse.mjs';
import { getByIdHandler, getMobileByIdHandler } from '../handlers/get-by-id.mjs';
import { getRandomImageHandler } from '../handlers/images/get-random-image.mjs';
import { createRouter } from '../lib/router.mjs';

// Gallery reads: web routes (CloudFront origin secret) and mobile routes (bearer token).
export const routes = {
  'GET /api/{id}': getByIdHandler,
  'GET /api/get-random-image': getRandomImageHandler,
  'GET /api/browse/random': getRandomBrowseHandler,
  'GET /api/mobile/{id}': getMobileByIdHandler,
  'OPTIONS /api/mobile/{id}': getMobileByIdHandler,
  'GET /api/mobile/browse/random': getMobileRandomBrowseHandler,
  'OPTIONS /api/mobile/browse/random': getMobileRandomBrowseHandler
};

export const handler = createRouter(routes);
