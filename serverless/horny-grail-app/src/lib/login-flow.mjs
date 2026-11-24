import { verifyAccessCode } from './access-code.mjs';
import { checkLoginAllowed, recordLoginFailure } from './login-limiter.mjs';

/**
 * Shared login sequence for the web and mobile session handlers:
 * limiter check -> code check -> record a failure.
 *
 * Returns one of:
 *   { status: 'ok' }
 *   { status: 'invalid' }
 *   { status: 'locked', retryAfterSeconds }
 *   { status: 'unavailable' }   limiter or secret lookup failed; never lets the attempt through
 */
export async function attemptLogin(code) {
  let gate;
  try {
    gate = await checkLoginAllowed();
  } catch (error) {
    console.error('Login limiter check failed; refusing login', { error });
    return { status: 'unavailable' };
  }

  if (!gate.allowed) {
    return { status: 'locked', retryAfterSeconds: gate.retryAfterSeconds };
  }

  let valid;
  try {
    valid = await verifyAccessCode(code);
  } catch (error) {
    console.error('Access code verification failed', { error });
    return { status: 'unavailable' };
  }

  if (!valid) {
    try {
      await recordLoginFailure();
    } catch (error) {
      console.error('Failed to record login failure', { error });
    }
    return { status: 'invalid' };
  }

  return { status: 'ok' };
}
