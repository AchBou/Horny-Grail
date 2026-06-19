// Import putItemHandler function from put-item.mjs 
import { putItemHandler } from '../../../src/handlers/put-item.mjs';
// Import dynamodb from aws-sdk 
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from "aws-sdk-client-mock";
// This includes all tests for putItemHandler() 
describe('Test putItemHandler', function () { 
    const ddbMock = mockClient(DynamoDBDocumentClient);
 
    beforeEach(() => {
        ddbMock.reset();
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
        expect(JSON.parse(result.body)).toEqual(expect.objectContaining({ id, ext: 'jpg' }));
    }); 

    it('should reject missing api key', async () => {
        const result = await putItemHandler({
            httpMethod: 'POST',
            body: JSON.stringify({ id: 'b'.repeat(64), ext: 'jpg' })
        });

        expect(result.statusCode).toEqual(401);
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
    });
}); 
 
