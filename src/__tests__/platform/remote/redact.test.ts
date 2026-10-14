/** Key-shaped tokens and named secrets never survive into text a user can see or store. */
import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../../../platform/remote/redact';

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

describe('a chosen mask', () => {
  it('replaces every key shape and named secret with it', () => {
    expect(redactSecrets('key sk-abcdef0123456789abcdef and gw_1', ['gw_1'], '***')).toBe('key *** and ***');
  });
});
