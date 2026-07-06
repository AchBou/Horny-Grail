// Create clients and set shared const values outside of the handler.

// Create a DocumentClient that represents the query to add an item
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../config/env.mjs';
import { requireReadOriginSecret } from '../lib/auth.mjs';
import { jsonResponse, methodNotAllowed, serverError } from '../lib/http.mjs';
const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

/**
 * A simple example includes a HTTP get method to get all items from a DynamoDB table.
 */
export const getAllItemsHandler = async (event) => {
    const method = event?.httpMethod || event?.requestContext?.http?.method || '';
    if (method !== 'GET') {
        return methodNotAllowed(`getAllItems only accepts GET method, you tried: ${method}`, event);
    }
    const authError = requireReadOriginSecret(event);
    if (authError) {
        return authError;
    }
    // All log statements are written to CloudWatch
    console.info('received:', event);

    // get all items from the table (only first 1MB data, you can use `LastEvaluatedKey` to get the rest of data)
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#scan-property
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
    const params = {
        TableName: getLookupTableName()
    };

    let items = [];
    try {
        const data = await ddbDocClient.send(new ScanCommand(params));
        items = data.Items || [];
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
