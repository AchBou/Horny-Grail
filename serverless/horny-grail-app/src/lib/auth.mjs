import { getWriteApiKey } from '../config/env.mjs';
import { unauthorized } from './http.mjs';

function getHeader(event, name) {
  const headers = event?.headers || {};
  const expected = name.toLowerCase();
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === expected);
  return match?.[1];
}

export function requireWriteApiKey(event) {
  const provided = getHeader(event, 'x-api-key');
  if (!provided || provided !== getWriteApiKey()) {
    return unauthorized(event);
  }

  return null;
}
