// Create clients and set shared const values outside of the handler.

// Create a DocumentClient that represents the query to add an item
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { lookupTableName } from '../config/env.mjs';
import { badRequest, jsonResponse, methodNotAllowed, serverError } from '../lib/http.mjs';
import { isValidImageId } from '../lib/validation.mjs';
const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

/**
 * A simple example includes a HTTP get method to get one item by id from a DynamoDB table.
 */
export const getByIdHandler = async (event) => {
  const method = event?.httpMethod || event?.requestContext?.http?.method || '';
  if (method !== 'GET') {
    return methodNotAllowed(`getMethod only accepts GET method, you tried: ${method}`);
  }
  // All log statements are written to CloudWatch
  console.info('received:', event);
 
  // Get id from pathParameters from APIGateway because of `/{id}` at template.yaml
  const id = event?.pathParameters?.id;
  if (!isValidImageId(id)) {
    return badRequest('Invalid image id');
  }
 
  // Get the item from the table
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#get-property
  var params = {
    TableName : lookupTableName,
    Key: { id: id },
  };

  try {
    const data = await ddbDocClient.send(new GetCommand(params));
    var item = data.Item;
  } catch (err) {
    console.error("Error", err);
    return serverError('Failed to get item');
  }
 
  const response = jsonResponse(200, item || null);
 
  // All log statements are written to CloudWatch
  console.info(`response from: ${event.path} statusCode: ${response.statusCode} body: ${response.body}`);
  return response;
}
