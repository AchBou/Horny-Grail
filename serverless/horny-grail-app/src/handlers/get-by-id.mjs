import { getAllItemsHandler } from './get-all-items.mjs';
import { requireReadOriginSecret } from '../lib/auth.mjs';
import { badRequest, jsonResponse, serverError } from '../lib/http.mjs';
import { getItemById } from '../lib/items-repository.mjs';
import { guardRequest } from '../lib/request-guards.mjs';
import { isValidImageId } from '../lib/validation.mjs';

/**
 * A simple example includes a HTTP get method to get one item by id from a DynamoDB table.
 */
export const getByIdHandler = async (event) => {
  const guardError = guardRequest(event, {
    handlerName: 'getById',
    method: 'GET',
    authorize: requireReadOriginSecret
  });
  if (guardError) {
    return guardError;
  }
  // Get id from pathParameters from APIGateway because of `/{id}` at template.yaml
  const id = event?.pathParameters?.id;
  if (!id) {
    return getAllItemsHandler(event);
  }

  if (!isValidImageId(id)) {
    return badRequest('Invalid image id', event);
  }
 
  try {
    var item = await getItemById(id);
  } catch (err) {
    console.error("Error", err);
    return serverError('Failed to get item', event);
  }
 
  const response = jsonResponse(200, item || null, event);
 
  return response;
}
