import { verifyAccessCode } from './access-code.mjs';
import { getClientIp } from './client-ip.mjs';
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from './login-limiter.mjs';

/**
 * Shared login sequence for the web and mobile session handlers:
 * limiter check -> code check -> record outcome.
 *
 * Returns one of:
 *   { status: 'ok' }
 *   { status: 'invalid' }
 *   { status: 'locked', retryAfterSeconds }
 *   { status: 'unavailable' }   limiter or secret lookup failed; never lets the attempt through
 */
export async function attemptLogin(event, code) {
  const ip = getClientIp(event);

  let gate;
  try {
    gate = await checkLoginAllowed(ip);
  } catch (error) {
    console.error('Login limiter check failed; refusing login', { ip, error });
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
      await recordLoginFailure(ip);
    } catch (error) {
      console.error('Failed to record login failure', { ip, error });
    }
    return { status: 'invalid' };
  }

  try {
    await recordLoginSuccess(ip);
  } catch (error) {
    console.error('Failed to clear login failures', { ip, error });
  }
  return { status: 'ok' };
}
