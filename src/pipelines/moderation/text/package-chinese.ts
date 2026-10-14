import index from '../../../assets/moderation/lexical-index.json';
import { fingerprint } from './fingerprint';
import { simplifiedChinese } from './chinese';
import { normalizeText } from './policy';
import type { Evidence } from './evidence';

const terms = Object.entries(index.terms).map(([length, values]) => ({ length: Number(length), keys: new Set<string>(values) }));

/** Match complete word runs; segmentation alone can misread ordinary Chinese compounds. */
export function packageChineseEvidence(text: string): Evidence[] {
  const normalized = simplifiedChinese(normalizeText(text));
  for (const [run] of normalized.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    for (const { length, keys } of terms) {
      if (run.length % length !== 0) continue;
      const unit = run.slice(0, length);
      if (keys.has(fingerprint(unit)) && unit.repeat(run.length / length) === run) return [{ source: 'coffee-and-fun' }];
    }
  }
  return [];
}
