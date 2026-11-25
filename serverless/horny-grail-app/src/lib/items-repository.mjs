import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../config/env.mjs';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function getItemById(id) {
  const data = await ddbDocClient.send(new GetCommand({
    TableName: getLookupTableName(),
    Key: { id }
  }));

  return data.Item || null;
}

/** Replaces an existing item's tags; no tags removes the attribute. Fails if the item is gone. */
export async function setItemTags(id, tags) {
  const update = tags.length > 0
    ? { UpdateExpression: 'SET #tags = :tags', ExpressionAttributeValues: { ':tags': tags } }
    : { UpdateExpression: 'REMOVE #tags' };

  await ddbDocClient.send(new UpdateCommand({
    TableName: getLookupTableName(),
    Key: { id },
    ConditionExpression: 'attribute_exists(#id)',
    ExpressionAttributeNames: { '#id': 'id', '#tags': 'tags' },
    ...update
  }));
}

export async function deleteItemById(id) {
  const data = await ddbDocClient.send(new DeleteCommand({
    TableName: getLookupTableName(),
    Key: { id },
    ReturnValues: 'ALL_OLD'
  }));

  return data.Attributes || null;
}
