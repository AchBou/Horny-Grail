import { requireReadOriginSecret } from '../lib/auth.mjs';
import { badRequest, jsonResponse, serverError } from '../lib/http.mjs';
import { decodeScanCursor, parseScanLimit, scanItemsPage } from '../lib/items-repository.mjs';
import { guardRequest } from '../lib/request-guards.mjs';

/**
 * A simple example includes a HTTP get method to get all items from a DynamoDB table.
 */
export const getAllItemsHandler = async (event) => {
    const guardError = guardRequest(event, {
        handlerName: 'getAllItems',
        method: 'GET',
        authorize: requireReadOriginSecret
    });
    if (guardError) {
        return guardError;
    }
    const limit = parseScanLimit(event?.queryStringParameters?.limit);
    if (limit == null) {
        return badRequest('Invalid limit. Expected an integer between 1 and 100.', event);
    }
    const cursor = decodeScanCursor(event?.queryStringParameters?.cursor);
    if (cursor === undefined) {
        return badRequest('Invalid cursor', event);
    }

    let page;
    try {
        page = await scanItemsPage({ cursor, limit });
    } catch (err) {
        console.error('Error scanning table:', err);
        return serverError('Failed to scan table', event);
    }


    return jsonResponse(200, page, event);
}
