// Create clients and set shared const values outside of the handler.
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';

const dynamoClient = new DynamoDBClient({});
import { randomBytes } from 'crypto';

// Get the DynamoDB table name from environment variables or use a default
const tableName = process.env.LOOKUP_TABLE || 'horny-grail-name-lookup';

// Generate a random hex string to use as a hash-like id
const randomHash = (length = 64) => randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);

/**
 * Scans the DynamoDB table with a random starting point to get a random item
 */
const scanTable = async (params) => {
    try {
        console.info('ExclusiveStartKey id:', params.ExclusiveStartKey.id.S);
        const command = new ScanCommand(params);
        const data = await dynamoClient.send(command);
        return data.Items;
    } catch (err) {
        console.error("Error scanning table:", err);
        throw err;
    }
};


/**
 * A function that returns a random image URL from the DynamoDB table
 */
export const getRandomImageHandler = async (event) => {
    const method = event?.httpMethod || event?.requestContext?.http?.method || '';
    if (method && method !== 'GET') {
        throw new Error(`getRandomImage only accepts GET method, you tried: ${method}`);
    }
    // All log statements are written to CloudWatch
    console.info('received:', event);

    try {
        const params = {
            TableName: tableName,
            Limit: 1,
            ExclusiveStartKey: {
                'id': {
                    S: randomHash(64)
                }
            },
            ReturnConsumedCapacity: 'TOTAL'
        };
        
        let items = await scanTable(params);
        while (items[0] === undefined) {
            params.ExclusiveStartKey.id.S = randomHash(64);
            items = await scanTable(params);
        }
        console.log('items',items)
        const key = items[0].id.S + '.' + items[0].ext.S;
        console.info("Random key is:", key);

        // Return the CloudFront URL
        const response = {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: 'https://dqvs0hmo3wpp7.cloudfront.net/files/' + key
            })
        };
        
        // All log statements are written to CloudWatch
        console.info(`Response: statusCode: ${response.statusCode} body: ${response.body}`);
        return response;
    } catch (err) {
        console.error("Error:", err);
        
        // Create a user-friendly error response
        const response = {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Error getting random image. Please try again later.'
            })
        };
        
        console.info(`Error response: statusCode: ${response.statusCode} body: ${response.body}`);
        return response;
    }
};
