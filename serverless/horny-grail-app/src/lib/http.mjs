export const jsonHeaders = {
  'Content-Type': 'application/json'
};

const corsAllowHeaders = 'content-type,authorization,x-api-key,x-requested-with';
const corsAllowMethods = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';

function getAllowedCorsOrigins() {
  return (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function getRequestOrigin(event) {
  return event?.headers?.origin || event?.headers?.Origin || '';
}

function getCorsHeaders(event) {
  const origin = getRequestOrigin(event);
  const allowedOrigins = getAllowedCorsOrigins();
  if (!origin || !allowedOrigins.includes(origin)) {
    return {};
  }

  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': corsAllowHeaders,
    'Access-Control-Allow-Methods': corsAllowMethods
  };
}

export function jsonResponse(statusCode, body, event) {
  return {
    statusCode,
    headers: {
      ...jsonHeaders,
      ...getCorsHeaders(event)
    },
    body: JSON.stringify(body)
  };
}

function errorResponse(statusCode, code, message, event) {
  return jsonResponse(statusCode, { code, message }, event);
}

export function corsPreflight(event) {
  return {
    statusCode: 204,
    headers: getCorsHeaders(event),
    body: ''
  };
}

export function methodNotAllowed(message, event) {
  return errorResponse(405, 'method_not_allowed', message, event);
}

export function badRequest(message, event) {
  return errorResponse(400, 'bad_request', message, event);
}

export function unauthorized(event) {
  return errorResponse(401, 'unauthorized', 'Unauthorized', event);
}

export function notFound(message = 'Not found', event) {
  return errorResponse(404, 'not_found', message, event);
}

export function tooManyRequests(retryAfterSeconds, event) {
  const response = errorResponse(429, 'too_many_attempts', 'Too many attempts. Try again later.', event);
  return {
    ...response,
    headers: {
      ...response.headers,
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds || 0)))
    }
  };
}

export function serviceUnavailable(message = 'Service temporarily unavailable', event) {
  return errorResponse(503, 'service_unavailable', message, event);
}

export function serverError(message = 'Internal server error', event) {
  return errorResponse(500, 'internal_server_error', message, event);
}
