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
 
        const expectedBody = JSON.stringify(['thumbnail-id1.jpeg', 'thumbnail-id2.jpeg']);
 
        // Compare the result with the expected result 
        expect(result.statusCode).toEqual(200);
        expect(result.headers).toEqual({
            'Content-Type': 'application/json'
        });
        expect(result.body).toEqual(expectedBody);
    }); 
}); 
