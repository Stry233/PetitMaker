/**
 * Secret redaction for user-visible/stored text. Provider SDK errors can quote
 * request details; anything shown in the chat transcript may be screenshotted,
 * copied, or exported — key-shaped tokens must never survive into it.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,          // OpenAI-style keys (also DeepSeek/gateways/OpenRouter)
  /\bpplx-[A-Za-z0-9_-]{10,}\b/g,        // Perplexity keys
  /\bAIza[\w-]{20,}\b/g,                 // Google API keys
  /\b[0-9a-f]{32}\.[A-Za-z0-9]{16}\b/g,  // Zhipu GLM keys
  /\b(Bearer\s+|api[-_]?key[=:]\s*)[A-Za-z0-9._~+/-]{16,}/gi, // auth headers / key= fragments
];

/** Escapes a literal secret for use inside a regular expression. */
function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes key-shaped tokens from `text`. Every non-empty entry in `secrets` is removed by value
 * first, which covers opaque gateway tokens that match no shape.
 */
export function redactSecrets(text: string, secrets?: readonly string[]): string {
  let out = text;
  for (const secret of secrets ?? []) {
    const literal = secret.trim();
    if (literal === '') continue;
    out = out.replace(new RegExp(escapeLiteral(literal), 'g'), '<redacted-key>');
  }
  for (const re of SECRET_PATTERNS) out = out.replace(re, '<redacted-key>');
  return out;
}
