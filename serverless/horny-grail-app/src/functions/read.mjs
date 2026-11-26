import {
  getDesktopRandomBrowseHandler,
  getMobileRandomBrowseHandler,
  getRandomBrowseHandler
} from '../handlers/browse/get-random-browse.mjs';
import { getByIdHandler, getMobileByIdHandler } from '../handlers/get-by-id.mjs';
import { getRandomImageHandler } from '../handlers/images/get-random-image.mjs';
import { listDesktopTagsHandler, listMobileTagsHandler, listWebTagsHandler } from '../handlers/tags/list-tags.mjs';
import { createRouter } from '../lib/router.mjs';

// Gallery reads: web routes (CloudFront origin secret), mobile routes (bearer token) and
// the desktop Watch tab (write key).
export const routes = {
  'GET /api/tags': listWebTagsHandler,
  'GET /api/mobile/tags': listMobileTagsHandler,
  'OPTIONS /api/mobile/tags': listMobileTagsHandler,
  'GET /api/desktop/browse/random': getDesktopRandomBrowseHandler,
  'OPTIONS /api/desktop/browse/random': getDesktopRandomBrowseHandler,
  'GET /api/desktop/tags': listDesktopTagsHandler,
  'OPTIONS /api/desktop/tags': listDesktopTagsHandler,
  'GET /api/{id}': getByIdHandler,
  'GET /api/get-random-image': getRandomImageHandler,
  'GET /api/browse/random': getRandomBrowseHandler,
  'GET /api/mobile/{id}': getMobileByIdHandler,
  'OPTIONS /api/mobile/{id}': getMobileByIdHandler,
  'GET /api/mobile/browse/random': getMobileRandomBrowseHandler,
  'OPTIONS /api/mobile/browse/random': getMobileRandomBrowseHandler
};

export const handler = createRouter(routes);
