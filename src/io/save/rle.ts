import { ImportError } from './import-error';
export function rleEncode(tokens: string[]): string {
  if (tokens.length === 0) return '';
  const runs: string[] = [];
  let current = tokens[0]!;
  let count = 1;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === current) {
      count++;
    } else {
      runs.push(count > 1 ? `${count}*${current}` : current);
      current = tokens[i]!;
      count = 1;
    }
  }
  runs.push(count > 1 ? `${count}*${current}` : current);
  return runs.join(',');
}

/** Decodes comma-separated RLE while bounding expansion from untrusted run counts. */
export function rleDecode(rle: string, maxTokens?: number): string[] {
  if (rle === '') return [];
  const tokens: string[] = [];
  for (const part of rle.split(',')) {
    const starIdx = part.indexOf('*');
    if (starIdx > 0) {
      const count = Number(part.slice(0, starIdx));
      if (!Number.isInteger(count) || count <= 0) throw new ImportError('malformed', 'Invalid cell data: bad RLE run count.');
      if (maxTokens !== undefined && tokens.length + count > maxTokens) {
        throw new ImportError('malformed', 'Invalid cell data: more cells than the map template holds.');
      }
      const token = part.slice(starIdx + 1);
      for (let i = 0; i < count; i++) tokens.push(token);
    } else {
      if (maxTokens !== undefined && tokens.length >= maxTokens) {
        throw new ImportError('malformed', 'Invalid cell data: more cells than the map template holds.');
      }
      tokens.push(part);
    }
  }
  return tokens;
}
