import { buildApiUrl, writeApiKey } from '$lib/config/privateConfig.js';

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return RETRYABLE_STATUS_CODES.has(status);
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

export async function putBinary(uploadUrl, body, headers = {}, { retries = DEFAULT_RETRIES } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body,
        headers
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

export function fetchRandomBrowsePage(cursor = null, limit = 18) {
  const url = new URL(buildApiUrl('/browse/random'));
  url.searchParams.set('limit', String(limit));
  if (cursor) {
    url.searchParams.set('cursor', cursor);
  }

  return requestJson(url.toString(), {}, { retries: 2 });
}

export function fetchAssetIntegrity(id) {
  return requestJson(buildApiUrl(`/assets/${id}/integrity`), {}, { retries: 2 });
}

export function signUpload(body) {
  return requestJson(buildApiUrl('/uploads/sign'), {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify(body)
  });
}

export function registerMetadata(id, ext) {
  return requestJson(buildApiUrl('/'), {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify({ id, ext })
  });
}
