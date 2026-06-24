// Import putItemHandler function from put-item.mjs 
import { putItemHandler } from '../../../src/handlers/put-item.mjs';
// Import dynamodb from aws-sdk 
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from "aws-sdk-client-mock";
import { jest } from '@jest/globals';
// This includes all tests for putItemHandler() 
describe('Test putItemHandler', function () { 
    const ddbMock = mockClient(DynamoDBDocumentClient);
 
    beforeEach(() => {
        ddbMock.reset();
        jest.spyOn(Math, 'random').mockReturnValue(0.42);
      });

    afterEach(() => {
        jest.restoreAllMocks();
    });
 
    // This test invokes putItemHandler() and compare the result  
    it('should add id to the table', async () => { 
        const id = 'b'.repeat(64);
        // Return the specified value whenever the spied put function is called 
        ddbMock.on(PutCommand).resolves({
            Attributes: undefined
        }); 
 
        const event = { 
            httpMethod: 'POST', 
            headers: {
                'x-api-key': 'test-write-api-key'
            },
            body: JSON.stringify({ id, ext: 'jpg' })
        }; 
     
        // Invoke putItemHandler() 
        const result = await putItemHandler(event); 
        
        const expectedResult = { 
            statusCode: 200, 
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(expect.objectContaining({ id, ext: 'jpg' }))
        }; 
 
        // Compare the result with the expected result 
        expect(result.statusCode).toEqual(expectedResult.statusCode);
        expect(result.headers).toEqual(expectedResult.headers);
        expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
            id,
            ext: 'jpg',
            status: 'active',
            randomKey: 0.42
        }));
    }); 

    it('should reject missing api key', async () => {
        const result = await putItemHandler({
            httpMethod: 'POST',
            body: JSON.stringify({ id: 'b'.repeat(64), ext: 'jpg' })
        });

        expect(result.statusCode).toEqual(401);
        expect(JSON.parse(result.body)).toEqual({
            code: 'unauthorized',
            message: 'Unauthorized'
        });
    });

    it('should reject invalid item payloads', async () => {
        const result = await putItemHandler({
            httpMethod: 'POST',
            headers: {
                'x-api-key': 'test-write-api-key'
            },
            body: JSON.stringify({ id: 'bad', ext: 'exe' })
        });

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            code: 'bad_request',
            message: 'Invalid image id'
        });
    });

    it('should accept webm items', async () => {
        const id = 'e'.repeat(64);
        ddbMock.on(PutCommand).resolves({
            Attributes: undefined
        });

        const result = await putItemHandler({
            httpMethod: 'POST',
            headers: {
                'x-api-key': 'test-write-api-key'
            },
            body: JSON.stringify({ id, ext: 'webm' })
        });

        expect(result.statusCode).toEqual(200);
        expect(JSON.parse(result.body)).toEqual(expect.objectContaining({ id, ext: 'webm' }));
    });
}); 
 
