import { Capacitor } from '@capacitor/core';
import { buildApiUrl, buildServiceUrl, writeApiKey } from '$lib/config/privateConfig.js';
import { getReadAccessToken } from '$lib/mobile/readSession.js';

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return RETRYABLE_STATUS_CODES.has(status);
}

export function isAbortError(error) {
  return error?.name === 'AbortError';
}

export function isUnauthorizedError(error) {
  return error?.status === 401;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }
}

async function parseJsonSafely(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function requestJson(url, init = {}, { retries = DEFAULT_RETRIES } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    throwIfAborted(init.signal);

    try {
      const response = await fetch(url, init);
      if (response.ok) {
        return parseJsonSafely(response);
      }

      const payload = await parseJsonSafely(response);
      const error = new Error(payload?.message || `Request failed with status ${response.status}`);
      error.status = response.status;
      error.code = payload?.code || null;
      error.payload = payload;

      if (!isRetryableStatus(response.status) || attempt === retries - 1) {
        throw error;
      }

      lastError = error;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      if (error?.status && !isRetryableStatus(error.status)) {
        throw error;
      }

      lastError = error;
      if (attempt === retries - 1) {
        throw error;
      }
    }

    await sleep(DEFAULT_RETRY_DELAY_MS * (attempt + 1));
  }

  throw lastError || new Error('Request failed');
}

export async function putBinary(uploadUrl, body, headers = {}, { retries = DEFAULT_RETRIES, signal = null } = {}) {
  let lastError = null;
  const uploadHeaders = {
    ...headers,
    ...(Capacitor.isNativePlatform() && Number.isSafeInteger(body?.size)
      ? { 'Content-Length': String(body.size) }
      : {})
  };

  for (let attempt = 0; attempt < retries; attempt += 1) {
    throwIfAborted(signal);

    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body,
        headers: uploadHeaders,
        signal
      });

      if (response.ok) {
        return;
      }

      const error = new Error(`Upload failed with status ${response.status}`);
      error.status = response.status;

      if (!isRetryableStatus(response.status) || attempt === retries - 1) {
        throw error;
      }

      lastError = error;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      lastError = error;
      if (attempt === retries - 1) {
        throw error;
      }
    }

    await sleep(DEFAULT_RETRY_DELAY_MS * (attempt + 1));
  }

  throw lastError || new Error('Upload failed');
}

function writeHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-api-key': writeApiKey
  };
}

function readHeaders() {
  const token = getReadAccessToken();
  if (!token) {
    const error = new Error('Enter the access code to continue');
    error.status = 401;
    error.code = 'unauthorized';
    throw error;
  }

  return {
    Authorization: `Bearer ${token}`
  };
}

export function createMobileReadSession(code, { signal = null } = {}) {
  return requestJson(buildServiceUrl('/auth/mobile/session'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code }),
    signal
  }, { retries: 1 });
}

export function fetchRandomBrowsePage(cursor = null, limit = 18, { signal = null } = {}) {
  const url = new URL(buildApiUrl('/mobile/browse/random'));
  url.searchParams.set('limit', String(limit));
  if (cursor) {
    url.searchParams.set('cursor', cursor);
  }

  return requestJson(url.toString(), {
    signal,
    headers: readHeaders()
  }, { retries: 2 });
}

export function fetchItemById(id, { signal = null } = {}) {
  return requestJson(buildApiUrl(`/mobile/${id}`), {
    signal,
    headers: readHeaders()
  }, { retries: 2 });
}

export function fetchAssetIntegrity(id, { signal = null } = {}) {
  return requestJson(buildApiUrl(`/assets/${id}/integrity`), {
    signal,
    headers: writeHeaders()
  }, { retries: 2 });
}

export function fetchMobileAssetIntegrity(id, { signal = null } = {}) {
  return requestJson(buildApiUrl(`/mobile/assets/${id}/integrity`), {
    signal,
    headers: readHeaders()
  }, { retries: 2 });
}

export function signUpload(body, { signal = null } = {}) {
  return requestJson(buildApiUrl('/uploads/sign'), {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify(body),
    signal
  });
}

export function registerMetadata(id, ext, { signal = null } = {}) {
  return requestJson(buildApiUrl('/'), {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify({ id, ext }),
    signal
  });
}
