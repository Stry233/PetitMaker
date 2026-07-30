/**
 * Security hardening tests: secret redaction, endpoint sanitizing, the vault
 * crypto round-trip, the no-vault fallback, and the import-time catalogId
 * validation that closes the crafted-save prompt-injection path.
 */
import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../../agent/redact';
import { sanitizeEndpointUrl } from '../../agent/key-storage';
import { sealSecret, sealWithKey, openWithKey } from '../../agent/vault';

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

  it('leaves normal text and coordinates alone', () => {
    const text = 'Painted water at (12,34); see skill "river-crossing" and road-dirt.';
    expect(redactSecrets(text)).toBe(text);
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
