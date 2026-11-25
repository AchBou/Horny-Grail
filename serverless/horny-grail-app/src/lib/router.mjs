import { notFound } from './http.mjs';

/**
 * Builds one Lambda handler that dispatches HTTP API (payload v2) events by route key,
 * e.g. "GET /api/{id}". Each route key must also be declared as an HttpApi event on the
 * function in template.yaml; an undeclared key never reaches the function.
 */
export function createRouter(routes) {
  return async (event) => {
    const route = routes[event?.routeKey];
    if (!route) {
      console.warn('No handler for route', { routeKey: event?.routeKey });
      return notFound('Not found', event);
    }
    return route(event);
  };
}
