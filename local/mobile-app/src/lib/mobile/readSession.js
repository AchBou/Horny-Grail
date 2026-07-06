const STORAGE_KEY = 'hornygrail-mobile-read-session-v1';
let memorySession = null;

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function parseStoredSession(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed?.token !== 'string' || !Number.isInteger(parsed?.expiresAt)) {
      return null;
    }

    if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function getReadSession() {
  if (memorySession && memorySession.expiresAt > Math.floor(Date.now() / 1000)) {
    return memorySession;
  }

  if (!canUseStorage()) {
    memorySession = null;
    return null;
  }

  const parsed = parseStoredSession(window.localStorage.getItem(STORAGE_KEY));
  if (!parsed) {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  memorySession = parsed;
  return memorySession;
}

export function saveReadSession(session) {
  memorySession = session;
  if (canUseStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
}

export function clearReadSession() {
  memorySession = null;
  if (canUseStorage()) {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function getReadAccessToken() {
  return getReadSession()?.token || '';
}
