export const jsonHeaders = {
  'Content-Type': 'application/json'
};

const corsAllowHeaders = 'content-type,authorization,x-api-key,x-requested-with';
const corsAllowMethods = 'GET,POST,OPTIONS';

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

export function corsPreflight(event) {
  return {
    statusCode: 204,
    headers: getCorsHeaders(event),
    body: ''
  };
}

export function methodNotAllowed(message, event) {
  return jsonResponse(405, { message }, event);
}

export function badRequest(message, event) {
  return jsonResponse(400, { message }, event);
}

export function unauthorized(event) {
  return jsonResponse(401, { message: 'Unauthorized' }, event);
}

export function serverError(message = 'Internal server error', event) {
  return jsonResponse(500, { message }, event);
}
