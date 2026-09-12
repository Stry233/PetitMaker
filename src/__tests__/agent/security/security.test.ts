/**
 * Security hardening tests: secret redaction, endpoint sanitizing, the vault
 * crypto round-trip, the no-vault fallback, and the import-time catalogId
 * validation that closes the crafted-save prompt-injection path.
 */
import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../../../agent/security/redact';
import { toRawFailure } from '../../../agent/providers/http-failure';
import { sanitizeEndpointUrl } from '../../../core/runtime/endpoint-url';
import { sealSecret, sealWithKey, openWithKey } from '../../../core/runtime/vault';

describe('redactSecrets', () => {
  it('scrubs key-shaped tokens of every supported provider format', () => {
    const text = [
      'error for key sk-0123456789abcdef0123456789abcdef please retry',
      'sk-ant-api03-AbCdEf123456789xyz failed',
      'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6 rejected',
      '0123456789abcdef0123456789abcdef.AbCdEf0123456789 invalid',
      'Authorization: Bearer abc123def456ghi789jkl012',
    ].join('\n');
    const out = redactSecrets(text);
    expect(out).not.toMatch(/sk-[A-Za-z0-9_-]{10,}/);
    expect(out).not.toContain('AIzaSy');
    expect(out).not.toMatch(/[0-9a-f]{32}\./);
    expect(out).not.toContain('abc123def456ghi789jkl012');
    expect(out).toContain('<redacted-key>');
  });

  it('scrubs Perplexity keys', () => {
    expect(redactSecrets('pplx-0123456789abcdefghij rejected')).toBe('<redacted-key> rejected');
  });

  it('scrubs a named secret whose shape matches no pattern', () => {
    const text = 'gateway refused token gw_7f3a2b1c for model x';
    expect(redactSecrets(text, ['gw_7f3a2b1c'])).toBe('gateway refused token <redacted-key> for model x');
  });

  it('replaces every occurrence of a named secret', () => {
    expect(redactSecrets('gw_1 then gw_1', ['gw_1'])).toBe('<redacted-key> then <redacted-key>');
  });

  it('ignores an empty named secret', () => {
    const text = 'nothing secret here';
    expect(redactSecrets(text, ['', '   '])).toBe(text);
  });

  it('leaves normal text and coordinates alone', () => {
    const text = 'Painted water at (12,34); see skill "river-crossing" and road-dirt.';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('toRawFailure', () => {
  it('scrubs the live key out of a provider error message', () => {
    const err = new Error('401 Unauthorized for token gw_7f3a2b1c');
    expect(toRawFailure(err, false, ['gw_7f3a2b1c']).message)
      .toBe('401 Unauthorized for token <redacted-key>');
  });
});

describe('sanitizeEndpointUrl', () => {
  it('adds https to scheme-less input', () => {
    expect(sanitizeEndpointUrl('gateway.example.edu/api')).toBe('https://gateway.example.edu/api');
  });
  it('upgrades non-loopback http to https (keys must not travel cleartext)', () => {
    expect(sanitizeEndpointUrl('http://gateway.example.edu/api')).toBe('https://gateway.example.edu/api');
  });
  it('allows http for loopback (local Ollama etc.)', () => {
    expect(sanitizeEndpointUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(sanitizeEndpointUrl('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080/v1');
  });
  it('rejects non-http(s) schemes and garbage', () => {
    expect(sanitizeEndpointUrl('ftp://host/x')).toBe('');
    expect(sanitizeEndpointUrl('   ')).toBe('');
    expect(sanitizeEndpointUrl('https://')).toBe('');
  });
  it('trims trailing slashes', () => {
    expect(sanitizeEndpointUrl('https://host/api/')).toBe('https://host/api');
  });
  it('drops credentials embedded in the URL', () => {
    // A password here would sit in a field persisted in the clear beside a key the vault seals,
    // and a browser refuses to fetch a URL carrying credentials.
    expect(sanitizeEndpointUrl('https://user:hunter2@gateway.example.edu/v1'))
      .toBe('https://gateway.example.edu/v1');
    expect(sanitizeEndpointUrl('http://root:toor@localhost:11434/v1'))
      .toBe('http://localhost:11434/v1');
  });
  it('rewrites the IPv6 loopback literal to localhost', () => {
    // CSP's host grammar admits no IPv6 literal; localhost names the same interface and
    // connect-src can express it.
    expect(sanitizeEndpointUrl('http://[::1]:11434/v1')).toBe('http://localhost:11434/v1');
  });
  it('accepts only the loopback spellings the CSP also allows', async () => {
    // An endpoint the field accepts has to be one connect-src can name.
    const { HEADERS_POLICY } = await import('../../../../security/headers-policy');
    const sources = HEADERS_POLICY.cspDirectives['connect-src'] ?? [];
    for (const host of ['localhost:11434', '127.0.0.1:11434']) {
      const url = `http://${host}/v1`;
      expect(sanitizeEndpointUrl(url), `${host} sanitized away`).toBe(url);
      // `hostname` already carries the brackets an IPv6 literal needs.
      expect(sources.some((s) => s.startsWith(`http://${new URL(url).hostname}:`)),
        `connect-src has no source for ${host}`).toBe(true);
    }
  });
});

describe('stored regional endpoint', () => {
  it('round-trips a host the provider declares', async () => {
    const { saveAgentSettings, loadAgentSettings } = await import('../../../agent/security/key-storage');
    const { providerBaseUrls } = await import('../../../agent/providers/defaults');
    const intl = providerBaseUrls('moonshot')[1]!;
    const base = loadAgentSettings();
    saveAgentSettings({ ...base, regionBaseUrl: { moonshot: intl } });
    expect(loadAgentSettings().regionBaseUrl?.moonshot).toBe(intl);
  });

  it('keeps only hosts the provider declares', async () => {
    // The key travels to whatever this names, and anything running in the origin can write
    // localStorage, so the declared host list is the allowlist.
    const { loadAgentSettings } = await import('../../../agent/security/key-storage');
    localStorage.setItem('petit-agent-settings-v1', JSON.stringify({
      provider: 'moonshot',
      regionBaseUrl: { moonshot: 'https://exfil.example/v1', qwen: 'http://127.0.0.1:1/v1' },
    }));
    expect(loadAgentSettings().regionBaseUrl).toBeUndefined();
  });
});

describe('stored custom endpoint', () => {
  it('sanitizes a stored URL the same way a typed one is', async () => {
    const { loadAgentSettings } = await import('../../../agent/security/key-storage');
    localStorage.setItem('petit-agent-settings-v1', JSON.stringify({
      provider: 'custom',
      // Written by hand rather than typed into the settings field: plain http to a public host
      // would carry the key in the clear, and credentials in the URL would sit beside it.
      customBaseUrl: 'http://user:hunter2@gateway.example.edu/v1/',
    }));
    expect(loadAgentSettings().customBaseUrl).toBe('https://gateway.example.edu/v1');
  });

  it('drops a stored URL that cannot be made usable', async () => {
    const { loadAgentSettings } = await import('../../../agent/security/key-storage');
    localStorage.setItem('petit-agent-settings-v1', JSON.stringify({ provider: 'custom', customBaseUrl: 'ftp://host/x' }));
    expect(loadAgentSettings().customBaseUrl).toBeUndefined();
  });

  it('leaves a loopback endpoint on http, which is where a local model runs', async () => {
    const { loadAgentSettings } = await import('../../../agent/security/key-storage');
    localStorage.setItem('petit-agent-settings-v1', JSON.stringify({ provider: 'custom', customBaseUrl: 'http://localhost:11434/v1' }));
    expect(loadAgentSettings().customBaseUrl).toBe('http://localhost:11434/v1');
  });
});

describe('vault', () => {
  it('falls back to null when IndexedDB is unavailable (jsdom)', async () => {
    // jsdom has no indexedDB → the vault must decline, not throw; key-storage
    // then keeps the base64 fallback.
    expect(typeof indexedDB).toBe('undefined');
    expect(await sealSecret('top secret')).toBeNull();
  });

  it.skipIf(typeof crypto === 'undefined' || !crypto.subtle)(
    'AES-GCM round-trips and tampering fails closed',
    async () => {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const blob = await sealWithKey(key, JSON.stringify({ claude: 'sk-ant-xyz' }));
      expect(blob.ct).not.toContain('sk-ant'); // ciphertext, not encoding
      expect(await openWithKey(key, blob)).toBe(JSON.stringify({ claude: 'sk-ant-xyz' }));
      const tampered = { ...blob, ct: blob.ct.slice(0, -4) + 'AAAA' };
      await expect(openWithKey(key, tampered)).rejects.toThrow();
    },
  );
});
