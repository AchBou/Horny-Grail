import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { ddbClient } from "../config/dynamodbClient.js";
import { DYNAMO_TABLE } from "../config/awsEnv.js";

// Check if an item with primary key id === hex exists in DynamoDB
/**
 * @param {string} hex
 * @returns {Promise<boolean>}
 */
export async function checkFileExistsByHex(hex) {
  if (!hex) return false;
  const params = {
    TableName: DYNAMO_TABLE,
    Key: {
      id: { S: hex }
    },
    ProjectionExpression: "id"
  };
  try {
    const cmd = new GetItemCommand(params);
    const res = await ddbClient.send(cmd);
    return !!(res && res.Item && res.Item.id && res.Item.id.S);
  } catch (e) {
    console.error("checkFileExistsByHex error", e);
    // Fail-open (assume it doesn't exist) to avoid blocking uploads due to transient errors
    return false;
  }
}
