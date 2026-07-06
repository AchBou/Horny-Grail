import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../../config/env.mjs';
import { requireMobileReadToken } from '../../lib/auth.mjs';
import { badRequest, corsPreflight, jsonResponse, methodNotAllowed, notFound, serverError } from '../../lib/http.mjs';
import { createSignedMediaView } from '../../lib/mobile-media.mjs';
import { isValidImageId } from '../../lib/validation.mjs';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const getMobileByIdHandler = async (event) => {
  const method = event?.httpMethod || event?.requestContext?.http?.method || '';
  if (method === 'OPTIONS') {
    return corsPreflight(event);
  }
  if (method !== 'GET') {
    return methodNotAllowed(`getMobileById only accepts GET method, you tried: ${method}`, event);
  }

  const authError = requireMobileReadToken(event);
  if (authError) {
    return authError;
  }

  const id = event?.pathParameters?.id;
  if (!isValidImageId(id)) {
    return badRequest('Invalid image id', event);
  }

  try {
    const data = await ddbDocClient.send(new GetCommand({
      TableName: getLookupTableName(),
      Key: { id }
    }));
    const item = data.Item || null;

    if (!item) {
      return notFound('Media was not found', event);
    }

    return jsonResponse(200, await createSignedMediaView(item), event);
  } catch (error) {
    console.error('Error getting mobile item', error);
    return serverError('Failed to get item', event);
  }
};
