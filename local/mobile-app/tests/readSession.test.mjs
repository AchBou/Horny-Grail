import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

// readSession.js uses window.localStorage when it exists; give it an in-memory one.
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  }
};

const KEY = 'hornygrail-mobile-read-session-v1';
const { clearReadSession, getReadAccessToken, getReadSession, saveReadSession } = await import('../src/lib/mobile/readSession.js');
const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  clearReadSession();
  store.clear();
});

test('returns a saved session and its token', () => {
  saveReadSession({ token: 'abc.def', expiresAt: now() + 600 });

  assert.equal(getReadSession()?.token, 'abc.def');
  assert.equal(getReadAccessToken(), 'abc.def');
  assert.ok(store.has(KEY));
});

test('treats an expired session as locked and removes it from storage', () => {
  saveReadSession({ token: 'old', expiresAt: now() - 1 });

  assert.equal(getReadSession(), null);
  assert.equal(getReadAccessToken(), '');
  assert.equal(store.has(KEY), false);
});

test('restores a still-valid session from storage after a restart', () => {
  store.set(KEY, JSON.stringify({ token: 'persisted', expiresAt: now() + 600 }));

  assert.equal(getReadSession()?.token, 'persisted');
});

test('drops malformed or incomplete stored sessions', () => {
  for (const bad of ['not json', JSON.stringify({ token: 'x' }), JSON.stringify({ token: 1, expiresAt: now() + 600 })]) {
    clearReadSession();
    store.set(KEY, bad);

    assert.equal(getReadSession(), null, bad);
    assert.equal(store.has(KEY), false, bad);
  }
});

test('clearing the session locks the vault', () => {
  saveReadSession({ token: 'abc', expiresAt: now() + 600 });

  clearReadSession();

  assert.equal(getReadSession(), null);
  assert.equal(store.has(KEY), false);
});
