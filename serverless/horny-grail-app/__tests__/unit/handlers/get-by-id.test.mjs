// Import getByIdHandler function from get-by-id.mjs 
import { getByIdHandler } from '../../../src/handlers/get-by-id.mjs'; 
// Import dynamodb from aws-sdk 
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from "aws-sdk-client-mock";
 
// This includes all tests for getByIdHandler() 
describe('Test getByIdHandler', () => { 
    const ddbMock = mockClient(DynamoDBDocumentClient);
 
    beforeEach(() => {
        ddbMock.reset();
      });
 
    // This test invokes getByIdHandler() and compare the result  
    it('should get item by id', async () => { 
        const id = 'a'.repeat(64);
        const item = { id, ext: 'jpg' }; 
 
        // Return the specified value whenever the spied get function is called 
        ddbMock.on(GetCommand).resolves({
            Item: item,
        }); 
 
        const event = { 
            httpMethod: 'GET', 
            headers: {
                'x-read-origin-secret': process.env.READ_ORIGIN_SECRET
            },
            pathParameters: { 
                id 
            } 
        };
 
        // Invoke getByIdHandler() 
        const result = await getByIdHandler(event); 
 
        const expectedResult = { 
            statusCode: 200, 
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(item) 
        }; 
 
        // Compare the result with the expected result 
        expect(result).toEqual(expectedResult); 
    }); 

    it('should reject invalid ids', async () => {
        const result = await getByIdHandler({
            httpMethod: 'GET',
            headers: {
                'x-read-origin-secret': process.env.READ_ORIGIN_SECRET
            },
            pathParameters: {
                id: 'not-a-valid-id'
            }
        });

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            code: 'bad_request',
            message: 'Invalid image id'
        });
    });

    it('should fall back to the list handler for an empty id', async () => {
        const items = [{ id: 'a'.repeat(64), ext: 'jpg' }];
        ddbMock.on(ScanCommand).resolves({
            Items: items
        });

        const result = await getByIdHandler({
            httpMethod: 'GET',
            headers: {
                'x-read-origin-secret': process.env.READ_ORIGIN_SECRET
            },
            pathParameters: {
                id: ''
            }
        });

        expect(result.statusCode).toEqual(200);
        expect(JSON.parse(result.body)).toEqual({ items, cursor: null });
    });
}); 
 
