// Centralized AWS environment configuration for the desktop app
const env = import.meta.env;

export const REGION = env.VITE_AWS_REGION || "us-east-1";

function getCredentials() {
  const accessKeyId = env.VITE_AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.VITE_AWS_SECRET_ACCESS_KEY;
  const sessionToken = env.VITE_AWS_SESSION_TOKEN; // optional

  if (accessKeyId && secretAccessKey) {
    return { accessKeyId, secretAccessKey, sessionToken };
  }
  return undefined;
}

export function getAwsClientOptions() {
  const options = { region: REGION };
  const credentials = getCredentials();
  if (credentials) {
    options.credentials = credentials;
  }
  return options;
}

export const BUCKET_NAME = env.VITE_BUCKET_NAME || "horny-grail-bucket";
export const DYNAMO_TABLE = env.VITE_DYNAMO_TABLE || "horny-grail-table";
