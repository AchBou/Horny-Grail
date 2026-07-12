// Create clients and set shared const values outside of the handler.

// Create a DocumentClient that represents the query to add an item
import { requireReadOriginSecret } from '../../lib/auth.mjs';
import { badRequest, jsonResponse, serverError } from '../../lib/http.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';
import { decodeScanCursor, parseScanLimit, scanItemsPage } from '../../lib/items-repository.mjs';

/**
 * HTTP GET method to get all thumbnails (id.ext) from a DynamoDB table.
 */
export const getAllThumbnailsHandler = async (event) => {
  const guardError = guardRequest(event, {
    handlerName: 'getAllThumbnails',
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

    // Map items to an array of thumbnail filenames expected by the front: "thumbnail-<id>.jpeg"
    const thumbnails = page.items
        .map((item) => {
            // With DynamoDBDocumentClient, items are plain JS objects
            const id = item?.id;
            if (!id || typeof id !== 'string') return null;
            return `thumbnail-${id}.jpeg`;
        })
        .filter(Boolean);

    return jsonResponse(200, { items: thumbnails, cursor: page.cursor }, event);
}
