import crypto from 'node:crypto';
import { getMobileReadTokenTtlSeconds } from '../config/env.mjs';
import { getAppSecret } from './app-secrets.mjs';
import { unauthorized } from './http.mjs';

function getHeader(event, name) {
  const headers = event?.headers || {};
  const expected = name.toLowerCase();
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === expected);
  return match?.[1];
}

function encodeBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function createHmacSignature(value, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(value)
    .digest('base64url');
}

function timingSafeEqualStrings(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getBearerToken(event) {
  const authorization = getHeader(event, 'authorization');
  if (typeof authorization !== 'string') {
    return null;
  }

  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

/** True when the request carries the desktop uploader's write key. */
export async function hasWriteApiKey(event) {
  const provided = getHeader(event, 'x-api-key');
  return Boolean(provided) && timingSafeEqualStrings(provided, await getAppSecret('writeApiKey'));
}

export async function requireWriteApiKey(event) {
  if (!(await hasWriteApiKey(event))) {
    return unauthorized(event);
  }

  return null;
}

export async function requireReadOriginSecret(event) {
  const provided = getHeader(event, 'x-read-origin-secret');
  if (!timingSafeEqualStrings(provided, await getAppSecret('readOriginSecret'))) {
    return unauthorized(event);
  }

  return null;
}

export async function issueMobileReadToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + getMobileReadTokenTtlSeconds();
  const payload = encodeBase64Url(JSON.stringify({
    aud: 'mobile-read',
    exp: expiresAt
  }));
  const signature = createHmacSignature(payload, await getAppSecret('mobileReadTokenSecret'));

  return {
    token: `${payload}.${signature}`,
    expiresAt
  };
}

export async function verifyMobileReadToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) {
    return null;
  }

  const expectedSignature = createHmacSignature(payloadPart, await getAppSecret('mobileReadTokenSecret'));
  if (!timingSafeEqualStrings(signaturePart, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(payloadPart));
    if (payload?.aud !== 'mobile-read' || !Number.isInteger(payload?.exp)) {
      return null;
    }

    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function requireMobileReadToken(event) {
  const token = getBearerToken(event);
  if (!(await verifyMobileReadToken(token))) {
    return unauthorized(event);
  }

  return null;
}

/**
 * Upload and metadata routes accept either the desktop uploader's write API key or a
 * mobile session token from the passphrase login. The mobile app holds no permanent key.
 */
export async function requireWriteAccess(event) {
  if (await hasWriteApiKey(event)) {
    return null;
  }

  return requireMobileReadToken(event);
}
