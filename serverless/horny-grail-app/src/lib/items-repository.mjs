import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getLookupTableName } from '../config/env.mjs';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function getItemById(id) {
  const data = await ddbDocClient.send(new GetCommand({
    TableName: getLookupTableName(),
    Key: { id }
  }));

  return data.Item || null;
}

export async function scanAllItems() {
  const data = await ddbDocClient.send(new ScanCommand({
    TableName: getLookupTableName()
  }));

  return data.Items || [];
}

export async function deleteItemById(id) {
  const data = await ddbDocClient.send(new DeleteCommand({
    TableName: getLookupTableName(),
    Key: { id },
    ReturnValues: 'ALL_OLD'
  }));

  return data.Attributes || null;
}
