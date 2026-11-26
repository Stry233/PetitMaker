/** Proof Key for Code Exchange (RFC 7636): the secret a page keeps while its user signs in elsewhere. */
import { bytesToBase64 } from '../../core/base/bytes';

/** A PKCE pair: the page keeps `verifier`, the sign-in address carries `challenge`. */
interface PkcePair {
  readonly verifier: string;
  /** Base64url of the verifier's SHA-256, the `S256` method. */
  readonly challenge: string;
}

/** `byteCount` random bytes as base64url text; the value a sign-in round is recognized by. */
export function randomToken(byteCount: number): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(byteCount)), { url: true });
}

/** A fresh pair; 48 bytes make a 64-character verifier, inside the 43 to 128 the RFC allows. */
export async function newPkcePair(): Promise<PkcePair> {
  const verifier = randomToken(48);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: bytesToBase64(new Uint8Array(digest), { url: true }) };
}
