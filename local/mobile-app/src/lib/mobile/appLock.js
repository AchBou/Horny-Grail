import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { clearReadSession, getReadSession } from '$lib/mobile/readSession.js';

// How long the app may sit in the background before the vault locks again.
export const LOCK_AFTER_MS = 60 * 1000;

const HIDDEN_AT_KEY = 'hornygrail-mobile-hidden-at-v1';
const listeners = new Set();

let started = false;
let hiddenAt = null;
let skipNextBackground = false;

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function persistHiddenAt(value) {
  if (!canUseStorage()) {
    return;
  }

  if (value == null) {
    window.localStorage.removeItem(HIDDEN_AT_KEY);
  } else {
    window.localStorage.setItem(HIDDEN_AT_KEY, String(value));
  }
}

function readPersistedHiddenAt() {
  if (!canUseStorage()) {
    return null;
  }

  const value = Number.parseInt(window.localStorage.getItem(HIDDEN_AT_KEY) || '', 10);
  return Number.isFinite(value) ? value : null;
}

function lock(reason) {
  const hadSession = Boolean(getReadSession());
  clearReadSession();
  if (hadSession) {
    for (const listener of listeners) {
      listener(reason);
    }
  }
}

function handleBackground() {
  if (skipNextBackground) {
    // A media picker or file chooser is in front of the app; that is not "leaving".
    return;
  }

  if (hiddenAt == null) {
    hiddenAt = Date.now();
    persistHiddenAt(hiddenAt);
  }
}

function handleForeground() {
  skipNextBackground = false;
  if (hiddenAt != null && Date.now() - hiddenAt >= LOCK_AFTER_MS) {
    lock('background');
  }

  hiddenAt = null;
  persistHiddenAt(null);
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    handleBackground();
  } else {
    handleForeground();
  }
}

/**
 * Starts the vault auto-lock once per app run. The read session is cleared when the
 * app comes back after LOCK_AFTER_MS in the background, and on a cold start if the
 * app was last hidden longer ago than that (e.g. it was killed while in the background).
 */
export function startAppLock() {
  if (started || typeof window === 'undefined') {
    return;
  }
  started = true;

  const lastHiddenAt = readPersistedHiddenAt();
  persistHiddenAt(null);
  if (lastHiddenAt != null && Date.now() - lastHiddenAt >= LOCK_AFTER_MS) {
    lock('restart');
  }

  if (Capacitor.isNativePlatform()) {
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        handleForeground();
      } else {
        handleBackground();
      }
    });
  } else {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
}

/** Calls `listener(reason)` whenever the vault locks. Returns an unsubscribe function. */
export function onAppLock(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Call right before opening a system picker so the trip out of the app to choose
 * files does not lock the vault.
 */
export function allowNextBackground() {
  skipNextBackground = true;
}
