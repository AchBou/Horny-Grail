import { S3Client } from "@aws-sdk/client-s3";
import { getAwsClientOptions } from "./awsEnv.js";

const options = getAwsClientOptions();
options.region = "us-west-2";

// Create an Amazon S3 service client object using shared AWS options.
const s3Client = new S3Client(options);
export { s3Client };