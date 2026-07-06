import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../../config/env.mjs';
import { requireReadOriginSecret } from '../../lib/auth.mjs';
import { jsonResponse, methodNotAllowed, notFound, serverError } from '../../lib/http.mjs';

const RANDOM_IMAGE_INDEX = 'RandomImageIndex';
const ACTIVE_STATUS = 'active';
const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function queryRandomImage(randomKey) {
  const data = await ddbDocClient.send(new QueryCommand({
    TableName: getLookupTableName(),
    IndexName: RANDOM_IMAGE_INDEX,
    KeyConditionExpression: '#status = :status AND randomKey >= :randomKey',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': ACTIVE_STATUS,
      ':randomKey': randomKey
    },
    Limit: 1,
    ScanIndexForward: true
  }));

  return data.Items?.[0] || null;
}

export const getRandomImageHandler = async (event) => {
  const method = event?.httpMethod || event?.requestContext?.http?.method || '';
  if (method && method !== 'GET') {
    return methodNotAllowed(`getRandomImage only accepts GET method, you tried: ${method}`, event);
  }

  const authError = requireReadOriginSecret(event);
  if (authError) {
    return authError;
  }

  try {
    const randomKey = Math.random();
    const item = await queryRandomImage(randomKey) || await queryRandomImage(0);

    if (!item) {
      return notFound('No active images found', event);
    }

    return jsonResponse(200, {
      id: item.id,
      ext: item.ext
    }, event);
  } catch (err) {
    console.error('Error getting random image:', err);
    return serverError('Error getting random image. Please try again later.', event);
  }
};
