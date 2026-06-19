// Create the DynamoDB service client module using ES6 syntax.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { getAwsClientOptions, REGION } from "./awsEnv.js";

// Create an Amazon DynamoDB service client object using shared AWS options.
export const ddbClient = new DynamoDBClient(getAwsClientOptions());
