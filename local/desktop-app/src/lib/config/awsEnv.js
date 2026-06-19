// Centralized AWS environment configuration for the desktop app
const env = import.meta.env;

/**
 * @param {string} name
 * @param {string | undefined} value
 * @returns {string}
 */
const requireEnv = (name, value) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

export const REGION = requireEnv("VITE_AWS_REGION", env.VITE_AWS_REGION);

/**
 * @returns {{ accessKeyId: string, secretAccessKey: string, sessionToken?: string } | undefined}
 */
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
  /** @type {{ region: string, credentials?: { accessKeyId: string, secretAccessKey: string, sessionToken?: string } }} */
  const options = { region: REGION };
  const credentials = getCredentials();
  if (credentials) {
    options.credentials = credentials;
  }
  return options;
}

export const BUCKET_NAME = requireEnv("VITE_BUCKET_NAME", env.VITE_BUCKET_NAME);
export const DYNAMO_TABLE = requireEnv("VITE_DYNAMO_TABLE", env.VITE_DYNAMO_TABLE);
