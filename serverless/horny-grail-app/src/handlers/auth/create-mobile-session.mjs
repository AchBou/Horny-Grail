import { jsonResponse, serviceUnavailable, tooManyRequests, unauthorized } from '../../lib/http.mjs';
import { issueMobileReadToken } from '../../lib/auth.mjs';
import { attemptLogin } from '../../lib/login-flow.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';

function parseBody(event) {
  try {
    const raw = event?.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : event?.body || '{}';
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const createMobileSessionHandler = async (event) => {
  const guardError = await guardRequest(event, {
    handlerName: 'createMobileSession',
    method: 'POST',
    allowOptions: true
  });
  if (guardError) {
    return guardError;
  }

  const body = parseBody(event);
  const outcome = await attemptLogin(body?.code);

  switch (outcome.status) {
    case 'ok':
      return jsonResponse(200, await issueMobileReadToken(), event);
    case 'locked':
      return tooManyRequests(outcome.retryAfterSeconds, event);
    case 'unavailable':
      return serviceUnavailable('Login is temporarily unavailable. Try again later.', event);
    default:
      return unauthorized(event);
  }
};
