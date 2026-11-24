#!/usr/bin/env node
// Clears every failed-login counter and lockout, so you can log in again immediately.
//
//   npm run unlock-logins
//   Options: --table <name>  --stack <name>  --region <region>
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { describeStack, parseArgs, resolveRegion } from './lib/stack-config.mjs';

async function resolveTableName(args) {
  if (args.values.table) {
    return args.values.table;
  }

  const { stackName, outputs } = await describeStack(args);
  const tableName = outputs.LoginAttemptsTableName;
  if (!tableName) {
    throw new Error(`Stack ${stackName} has no LoginAttemptsTableName output. Deploy first or pass --table <name>.`);
  }
  return tableName;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tableName = await resolveTableName(args);
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: resolveRegion(args) }));

  let deleted = 0;
  let startKey;
  do {
    const page = await client.send(new ScanCommand({
      TableName: tableName,
      ProjectionExpression: 'pk',
      ExclusiveStartKey: startKey
    }));

    const keys = (page.Items || []).map((item) => ({ pk: item.pk }));
    for (let index = 0; index < keys.length; index += 25) {
      let requests = keys.slice(index, index + 25).map((Key) => ({ DeleteRequest: { Key } }));
      while (requests.length > 0) {
        const result = await client.send(new BatchWriteCommand({ RequestItems: { [tableName]: requests } }));
        requests = result.UnprocessedItems?.[tableName] || [];
      }
    }

    deleted += keys.length;
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  console.log(`Cleared ${deleted} login record(s) from ${tableName}. Logins are unlocked.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
