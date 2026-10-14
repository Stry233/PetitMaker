/**
 * Secret redaction for user-visible and stored text. Provider errors can quote request details,
 * and anything shown may be screenshotted, copied or exported, so key-shaped tokens must never
 * survive into it.
 */
import { escapeRegExp } from '../../core/base/text';

export const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,          // OpenAI-style keys (also DeepSeek/gateways/OpenRouter)
  /\bpplx-[A-Za-z0-9_-]{10,}\b/g,        // Perplexity keys
  /\bAIza[\w-]{20,}\b/g,                 // Google API keys
  /\b[0-9a-f]{32}\.[A-Za-z0-9]{16}\b/g,  // Zhipu GLM keys
  /\b(Bearer\s+|api[-_]?key[=:]\s*)[A-Za-z0-9._~+/-]{16,}/gi, // auth headers / key= fragments
];

/**
 * Replaces key-shaped tokens in `text` with `mask`. Every non-empty entry in `secrets` is replaced
 * by value first, which covers opaque gateway tokens that match no shape.
 */
export function redactSecrets(text: string, secrets?: readonly string[], mask = '<redacted-key>'): string {
  let out = text;
  for (const secret of secrets ?? []) {
    const literal = secret.trim();
    if (literal === '') continue;
    out = out.replace(new RegExp(escapeRegExp(literal), 'g'), mask);
  }
  for (const re of SECRET_PATTERNS) out = out.replace(re, mask);
  return out;
}
