import { getByIdHandler, getMobileByIdHandler } from '../../../src/handlers/get-by-id.mjs';
import { issueMobileReadToken } from '../../../src/lib/auth.mjs';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from "aws-sdk-client-mock";
 
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

    it('should reject an empty id (GET /api/ is routed to the list handler instead)', async () => {
        const result = await getByIdHandler({
            httpMethod: 'GET',
            headers: { 'x-read-origin-secret': process.env.READ_ORIGIN_SECRET },
            pathParameters: { id: '' }
        });

        expect(result.statusCode).toEqual(400);
    });

    it('should return 200 with null on the web when the item does not exist', async () => {
        ddbMock.on(GetCommand).resolves({});

        const result = await getByIdHandler({
            httpMethod: 'GET',
            headers: { 'x-read-origin-secret': process.env.READ_ORIGIN_SECRET },
            pathParameters: { id: 'a'.repeat(64) }
        });

        expect(result.statusCode).toEqual(200);
        expect(JSON.parse(result.body)).toBeNull();
    });

    it('should require a mobile session on the mobile route', async () => {
        const result = await getMobileByIdHandler({
            httpMethod: 'GET',
            headers: { 'x-read-origin-secret': process.env.READ_ORIGIN_SECRET },
            pathParameters: { id: 'a'.repeat(64) }
        });

        expect(result.statusCode).toEqual(401);
    });

    it('should return 404 on mobile when the item does not exist', async () => {
        ddbMock.on(GetCommand).resolves({});

        const result = await getMobileByIdHandler({
            httpMethod: 'GET',
            headers: { authorization: `Bearer ${(await issueMobileReadToken()).token}` },
            pathParameters: { id: 'a'.repeat(64) }
        });

        expect(result.statusCode).toEqual(404);
    });
});
 
