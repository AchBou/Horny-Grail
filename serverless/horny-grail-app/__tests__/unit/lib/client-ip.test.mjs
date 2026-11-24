import { getClientIp, normalizeClientIp } from '../../../src/lib/client-ip.mjs';

function event({ sourceIp = '203.0.113.9', headers = {} } = {}) {
  return { headers, requestContext: { http: { sourceIp } } };
}

describe('getClientIp', () => {
  it('uses the API Gateway source IP for direct requests', () => {
    expect(getClientIp(event())).toBe('203.0.113.9');
  });

  it('trusts CloudFront-Viewer-Address only with the origin secret', () => {
    const viaCloudFront = event({
      sourceIp: '130.176.0.1',
      headers: {
        'cloudfront-viewer-address': '198.51.100.7:51234',
        'x-read-origin-secret': process.env.READ_ORIGIN_SECRET
      }
    });

    expect(getClientIp(viaCloudFront)).toBe('198.51.100.7');
  });

  it('ignores a forged CloudFront-Viewer-Address', () => {
    const forged = event({
      headers: {
        'cloudfront-viewer-address': '198.51.100.7:51234',
        'x-read-origin-secret': 'wrong'
      }
    });

    expect(getClientIp(forged)).toBe('203.0.113.9');
  });

  it('strips the port from an IPv6 viewer address and keys on the /64', () => {
    const viaCloudFront = event({
      headers: {
        'CloudFront-Viewer-Address': '2001:db8:abcd:12:1:2:3:4:443',
        'X-Read-Origin-Secret': process.env.READ_ORIGIN_SECRET
      }
    });

    expect(getClientIp(viaCloudFront)).toBe('2001:db8:abcd:12::/64');
  });
});

describe('normalizeClientIp', () => {
  it('groups IPv6 addresses by /64', () => {
    expect(normalizeClientIp('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(normalizeClientIp('2001:DB8:0:0:ffff::9')).toBe('2001:db8:0:0::/64');
  });

  it('unwraps IPv4-mapped IPv6', () => {
    expect(normalizeClientIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
  });

  it('falls back to unknown', () => {
    expect(normalizeClientIp('')).toBe('unknown');
    expect(normalizeClientIp(undefined)).toBe('unknown');
  });
});
