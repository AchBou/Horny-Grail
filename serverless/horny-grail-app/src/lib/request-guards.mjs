import { corsPreflight, methodNotAllowed, serverError } from './http.mjs';

export function getRequestMethod(event) {
  return event?.httpMethod || event?.requestContext?.http?.method || '';
}

export async function guardRequest(event, {
  handlerName,
  method,
  allowOptions = false,
  allowMissingMethod = false,
  authorize
} = {}) {
  const requestMethod = getRequestMethod(event);

  if (allowOptions && requestMethod === 'OPTIONS') {
    return corsPreflight(event);
  }

  if (method) {
    const hasUnexpectedMethod = allowMissingMethod
      ? requestMethod && requestMethod !== method
      : requestMethod !== method;

    if (hasUnexpectedMethod) {
      return methodNotAllowed(`${handlerName} only accepts ${method} method, you tried: ${requestMethod}`, event);
    }
  }

  if (typeof authorize === 'function') {
    try {
      return await authorize(event);
    } catch (error) {
      console.error(`${handlerName} authorization failed`, { error: error?.message || String(error) });
      return serverError('Authorization is temporarily unavailable', event);
    }
  }

  return null;
}
