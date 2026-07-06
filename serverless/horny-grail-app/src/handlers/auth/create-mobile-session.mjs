import { corsPreflight, jsonResponse, methodNotAllowed, unauthorized } from '../../lib/http.mjs';
import { getReadAccessCode } from '../../config/env.mjs';
import { issueMobileReadToken } from '../../lib/auth.mjs';

function getMethod(event) {
  return event?.httpMethod || event?.requestContext?.http?.method || '';
}

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch {
    return null;
  }
}

export const createMobileSessionHandler = async (event) => {
  const method = getMethod(event);

  if (method === 'OPTIONS') {
    return corsPreflight(event);
  }

  if (method !== 'POST') {
    return methodNotAllowed(`createMobileSession only accepts POST method, you tried: ${method}`, event);
  }

  const body = parseBody(event);
  if (!body || body.code !== getReadAccessCode()) {
    return unauthorized(event);
  }

  return jsonResponse(200, issueMobileReadToken(), event);
};
