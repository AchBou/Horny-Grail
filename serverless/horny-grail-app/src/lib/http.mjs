export const jsonHeaders = {
  'Content-Type': 'application/json'
};

export function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body)
  };
}

export function methodNotAllowed(message) {
  return jsonResponse(405, { message });
}

export function badRequest(message) {
  return jsonResponse(400, { message });
}

export function unauthorized() {
  return jsonResponse(401, { message: 'Unauthorized' });
}

export function serverError(message = 'Internal server error') {
  return jsonResponse(500, { message });
}
