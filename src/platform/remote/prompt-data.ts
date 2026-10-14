/** Quotes reference data without allowing it to close surrounding prompt tags. This is framing, not an instruction detector. */
export function quotePromptData(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
