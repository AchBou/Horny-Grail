import { createMobileSessionHandler } from '../handlers/auth/create-mobile-session.mjs';
import { createSessionHandler } from '../handlers/auth/create-session.mjs';
import { createRouter } from '../lib/router.mjs';

// Passphrase logins: web (signed cookies) and mobile (bearer token).
export const routes = {
  'GET /auth/session': createSessionHandler,
  'POST /auth/session': createSessionHandler,
  'OPTIONS /auth/session': createSessionHandler,
  'POST /auth/mobile/session': createMobileSessionHandler,
  'OPTIONS /auth/mobile/session': createMobileSessionHandler
};

export const handler = createRouter(routes);
