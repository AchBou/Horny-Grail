import crypto from 'node:crypto';

function getHeader(event, name) {
  const headers = event?.headers || {};
  const expected = name.toLowerCase();
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === expected);
  return typeof match?.[1] === 'string' ? match[1] : '';
}

function safeEqual(left, right) {
  if (!left || !right) {
    return false;
  }

  const a = crypto.createHash('sha256').update(left).digest();
  const b = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Strips the ":port" suffix CloudFront adds to CloudFront-Viewer-Address. */
function stripPort(address) {
  const lastColon = address.lastIndexOf(':');
  if (lastColon <= 0) {
    return address;
  }

  return address.slice(0, lastColon);
}

function expandIpv6(address) {
  const [head, tail = null] = address.split('::');
  const headParts = head ? head.split(':') : [];
  if (tail === null) {
    return headParts;
  }

  const tailParts = tail ? tail.split(':') : [];
  const missing = Math.max(0, 8 - headParts.length - tailParts.length);
  return [...headParts, ...Array(missing).fill('0'), ...tailParts];
}

/**
 * IPv6 clients usually control a whole /64, so lockouts are keyed on that prefix.
 */
export function normalizeClientIp(ip) {
  if (typeof ip !== 'string' || !ip) {
    return 'unknown';
  }

  const value = ip.trim().toLowerCase();
  if (!value.includes(':')) {
    return value;
  }

  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is really an IPv4 client.
  if (value.includes('.')) {
    return value.slice(value.lastIndexOf(':') + 1);
  }

  const parts = expandIpv6(value.replace(/^\[|\]$/g, ''));
  if (parts.length < 4) {
    return value;
  }

  return `${parts.slice(0, 4).map((part) => Number.parseInt(part || '0', 16).toString(16)).join(':')}::/64`;
}

/**
 * Behind CloudFront, API Gateway's sourceIp is a CloudFront edge address. The real viewer
 * IP comes from CloudFront-Viewer-Address, which is only trusted when the request also
 * carries the origin secret CloudFront injects, so a direct caller cannot spoof it.
 */
export function getClientIp(event) {
  const viewerAddress = getHeader(event, 'cloudfront-viewer-address');
  const originSecret = process.env.READ_ORIGIN_SECRET || '';
  if (viewerAddress && safeEqual(getHeader(event, 'x-read-origin-secret'), originSecret)) {
    return normalizeClientIp(stripPort(viewerAddress));
  }

  const sourceIp = event?.requestContext?.http?.sourceIp
    || event?.requestContext?.identity?.sourceIp
    || '';
  return normalizeClientIp(sourceIp);
}
