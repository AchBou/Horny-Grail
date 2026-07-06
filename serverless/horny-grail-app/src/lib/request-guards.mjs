import { corsPreflight, methodNotAllowed } from './http.mjs';

export function getRequestMethod(event) {
  return event?.httpMethod || event?.requestContext?.http?.method || '';
}

export function guardRequest(event, {
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
    return authorize(event);
  }

  return null;
}
