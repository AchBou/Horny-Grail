import { jsonResponse, unauthorized } from '../../lib/http.mjs';
import { getReadAccessCode } from '../../config/env.mjs';
import { issueMobileReadToken } from '../../lib/auth.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch {
    return null;
  }
}

export const createMobileSessionHandler = async (event) => {
  const guardError = guardRequest(event, {
    handlerName: 'createMobileSession',
    method: 'POST',
    allowOptions: true
  });
  if (guardError) {
    return guardError;
  }

  const body = parseBody(event);
  if (!body || body.code !== getReadAccessCode()) {
    return unauthorized(event);
  }

  return jsonResponse(200, issueMobileReadToken(), event);
};
