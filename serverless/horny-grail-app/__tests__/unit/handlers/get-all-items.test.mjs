// Import getAllItemsHandler function from get-all-items.mjs 
import { getAllThumbnailsHandler } from '../../../src/handlers/thumbnails/get-all-thumbnails.mjs';
// Import dynamodb from aws-sdk 
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from "aws-sdk-client-mock";
 
// This includes all tests for getAllThumbnailsHandler()
describe('Test getAllThumbnailsHandler', () => { 
    const ddbMock = mockClient(DynamoDBDocumentClient);
 
    beforeEach(() => {
        ddbMock.reset();
      });
 
    it('should return thumbnail filenames derived from ids', async () => { 
        const items = [{ id: 'id1', ext: 'png' }, { id: 'id2', ext: 'jpg' }]; 
 
        // Return the specified value whenever the spied scan function is called 
        ddbMock.on(ScanCommand).resolves({
            Items: items,
        }); 
 
        const event = { 
            httpMethod: 'GET',
            headers: {
                'x-read-origin-secret': process.env.READ_ORIGIN_SECRET
            }
        };
 
        // Invoke handler
        const result = await getAllThumbnailsHandler(event); 
 
        const expectedBody = JSON.stringify({
            items: ['thumbnail-id1.jpeg', 'thumbnail-id2.jpeg'],
            cursor: null
        });
 
        // Compare the result with the expected result 
        expect(result.statusCode).toEqual(200);
        expect(result.headers).toEqual({
            'Content-Type': 'application/json'
        });
        expect(result.body).toEqual(expectedBody);
    });

    it('should return a cursor for a continuation page', async () => {
        ddbMock.on(ScanCommand).resolves({
            Items: [{ id: 'id3' }],
            LastEvaluatedKey: { id: 'id3' }
        });

        const result = await getAllThumbnailsHandler({
            httpMethod: 'GET',
            headers: { 'x-read-origin-secret': process.env.READ_ORIGIN_SECRET },
            queryStringParameters: { limit: '1' }
        });

        const body = JSON.parse(result.body);
        expect(body.items).toEqual(['thumbnail-id3.jpeg']);
        expect(typeof body.cursor).toBe('string');
        const scan = ddbMock.commandCalls(ScanCommand)[0].args[0].input;
        expect(scan.Limit).toBe(1);
    });

    it('should reject invalid cursors', async () => {
        const result = await getAllThumbnailsHandler({
            httpMethod: 'GET',
            headers: { 'x-read-origin-secret': process.env.READ_ORIGIN_SECRET },
            queryStringParameters: { cursor: 'bad-value' }
        });

        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).message).toBe('Invalid cursor');
    });
});
