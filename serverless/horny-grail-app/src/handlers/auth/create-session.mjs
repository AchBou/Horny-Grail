import crypto from 'node:crypto';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});
let cachedPrivateKey = null;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getMethod(event) {
  return event?.httpMethod || event?.requestContext?.http?.method || '';
}

function parseBody(event) {
  const rawBody = event?.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event?.body || '';
  const contentType = event?.headers?.['content-type'] || event?.headers?.['Content-Type'] || '';

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return null;
    }
  }

  const params = new URLSearchParams(rawBody);
  return {
    code: params.get('code'),
    next: params.get('next')
  };
}

function normalizeRedirect(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }

  if (value.startsWith('/auth/')) {
    return '/';
  }

  return value;
}

function toCloudFrontBase64(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/=/g, '_')
    .replace(/\//g, '~');
}

async function getPrivateKey() {
  if (cachedPrivateKey) {
    return cachedPrivateKey;
  }

  const secretArn = requireEnv('CLOUDFRONT_PRIVATE_KEY_SECRET_ARN');
  const result = await secretsClient.send(new GetSecretValueCommand({
    SecretId: secretArn
  }));

  const secretString = result.SecretString || Buffer.from(result.SecretBinary || '').toString('utf8');
  try {
    const parsed = JSON.parse(secretString);
    cachedPrivateKey = parsed.privateKey || parsed.pem || secretString;
  } catch {
    cachedPrivateKey = secretString;
  }

  return cachedPrivateKey;
}

async function createSignedCookies() {
  const ttlSeconds = Number.parseInt(process.env.ACCESS_COOKIE_TTL_SECONDS || '604800', 10);
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const policy = JSON.stringify({
    Statement: [
      {
        Resource: requireEnv('CLOUDFRONT_COOKIE_RESOURCE'),
        Condition: {
          DateLessThan: {
            'AWS:EpochTime': expiresAt
          }
        }
      }
    ]
  });

  const signer = crypto.createSign('RSA-SHA1');
  signer.update(policy);
  const signature = signer.sign(await getPrivateKey(), 'base64');
  const cookieOptions = `Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}`;

  return [
    `CloudFront-Policy=${toCloudFrontBase64(policy)}; ${cookieOptions}`,
    `CloudFront-Signature=${signature.replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~')}; ${cookieOptions}`,
    `CloudFront-Key-Pair-Id=${requireEnv('CLOUDFRONT_KEY_PAIR_ID')}; ${cookieOptions}`
  ];
}

function redirectResponse(location, cookies = []) {
  return {
    statusCode: 303,
    headers: {
      Location: location,
      'Cache-Control': 'no-store'
    },
    cookies,
    body: ''
  };
}

export const createSessionHandler = async (event) => {
  const method = getMethod(event);

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };
  }

  if (method !== 'POST') {
    return redirectResponse('/access');
  }

  const body = parseBody(event);
  const next = normalizeRedirect(body?.next);

  if (!body || body.code !== requireEnv('READ_ACCESS_CODE')) {
    return redirectResponse(`/access?error=1&next=${encodeURIComponent(next)}`);
  }

  const cookies = await createSignedCookies();
  return redirectResponse(next, cookies);
};
