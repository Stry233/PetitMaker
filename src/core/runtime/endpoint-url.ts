/** Normalize a custom endpoint, requiring HTTPS except for loopback and removing URL credentials. */
export function sanitizeEndpointUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = `https://${u}`;
  try {
    const url = new URL(u);
    // The CSP host grammar cannot express an IPv6 literal.
    if (url.hostname === '[::1]') url.hostname = 'localhost';
    if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/i.test(url.hostname)) {
      url.protocol = 'https:';
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}
