// Create clients and set shared const values outside of the handler.

// Create a DocumentClient that represents the query to add an item
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

// Get the DynamoDB table name from environment variables
const tableName = process.env.LOOKUP_TABLE;

/**
 * HTTP GET method to get all thumbnails (id.ext) from a DynamoDB table.
 */
export const getAllThumbnailsHandler = async (event) => {
    const method = event?.httpMethod || event?.requestContext?.http?.method || '';
    if (method !== 'GET') {
        throw new Error(`getAllThumbnails only accept GET method, you tried: ${method}`);
    }
    // All log statements are written to CloudWatch
    console.info('received:', event);

    // get all items from the table (only first 1MB data, you can use `LastEvaluatedKey` to get the rest of data)
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#scan-property
    // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
    const params = {
        TableName: tableName
    };

    let items = [];
    try {
        const data = await ddbDocClient.send(new ScanCommand(params));
        items = data.Items || [];
        console.info('Raw scan items:', JSON.stringify(items));
    } catch (err) {
        console.error('Error scanning table:', err);
        // Return a 500 if scan fails
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: 'Failed to scan table' })
        };
    }

    // Map items to an array of thumbnail filenames expected by the front: "thumbnail-<hex>.jpeg"
    const thumbnails = items
        .map((item) => {
            // With DynamoDBDocumentClient, items are plain JS objects
            const hex = item?.id || item?.hex;
            if (!hex || typeof hex !== 'string') return null;
            return `thumbnail-${hex}.jpeg`;
        })
        .filter(Boolean);

    const response = {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(thumbnails)
    };

    // All log statements are written to CloudWatch
    const path = event?.path || event?.rawPath || '';
    console.info(`response from: ${path} statusCode: ${response.statusCode} body: ${response.body}`);
    return response;
}
