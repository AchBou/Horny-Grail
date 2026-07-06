import { requireReadOriginSecret } from '../lib/auth.mjs';
import { jsonResponse, serverError } from '../lib/http.mjs';
import { scanAllItems } from '../lib/items-repository.mjs';
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
    // All log statements are written to CloudWatch
    console.info('received:', event);

    // get all items from the table (only first 1MB data, you can use `LastEvaluatedKey` to get the rest of data)
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#scan-property
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
    let items = [];
    try {
        items = await scanAllItems();
        console.info('Raw scan items:', JSON.stringify(items));
    } catch (err) {
        console.error('Error scanning table:', err);
        // Return a 500 if scan fails
        return serverError('Failed to scan table', event);
    }


    const response = jsonResponse(200, items, event);

    // All log statements are written to CloudWatch
    const path = event?.path || event?.rawPath || '';
    console.info(`response from: ${path} statusCode: ${response.statusCode} body: ${response.body}`);
    return response;
}
