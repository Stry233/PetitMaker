/** A PKCE pair is a fresh verifier with the base64url SHA-256 that a provider checks it against. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newPkcePair, randomToken } from '../../../platform/remote/pkce';

describe('newPkcePair', () => {
  it('pairs a verifier of the allowed length with its S256 challenge', async () => {
    const { verifier, challenge } = await newPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('makes a new pair every round', async () => {
    expect((await newPkcePair()).verifier).not.toBe((await newPkcePair()).verifier);
    expect(randomToken(12)).not.toBe(randomToken(12));
  });
});
