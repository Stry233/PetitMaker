/** Cyrillic and Greek letters that render like Latin ones; folded only inside words that already mix scripts. */
const CONFUSABLE: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ј: 'j', ѕ: 's', һ: 'h', к: 'k', м: 'm', т: 't', в: 'b', н: 'h', ԁ: 'd', ԛ: 'q', ѡ: 'w', ӏ: 'l',
  α: 'a', ο: 'o', ρ: 'p', ν: 'v', τ: 't', υ: 'u', ι: 'i', κ: 'k', η: 'n', χ: 'x', ϲ: 'c', ѵ: 'v', ԝ: 'w', ⲅ: 'r',
};
/** Small capitals and other stylistic letters that NFKC leaves alone. */
const STYLED: Record<string, string> = {
  ᴀ: 'a', ʙ: 'b', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e', ꜰ: 'f', ɢ: 'g', ʜ: 'h', ɪ: 'i', ᴊ: 'j', ᴋ: 'k', ʟ: 'l', ᴍ: 'm', ɴ: 'n', ᴏ: 'o', ᴩ: 'p', ǫ: 'q', ʀ: 'r', ꜱ: 's', ᴛ: 't', ᴜ: 'u', ᴠ: 'v', ᴡ: 'w', ʏ: 'y', ᴢ: 'z',
};
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', $: 's', '!': 'i' };
const DIRECTION = /[‫‮⁧]/u;

/** Whole look-alike words fold only in text that also contains Latin; Russian or Greek captions keep their letters. */
function foldScripts(text: string): string {
  const latinElsewhere = /\p{Script=Latin}/u.test(text);
  return text.replace(/[\p{L}\p{M}]+/gu, run => {
    const styled = [...run].map(c => STYLED[c] ?? c).join('');
    if (!/[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(styled)) return styled;
    const mixed = /\p{Script=Latin}/u.test(styled);
    const lookalike = latinElsewhere && [...styled].every(c => CONFUSABLE[c] || /\p{Script=Latin}/u.test(c));
    return mixed || lookalike ? [...styled].map(c => CONFUSABLE[c] ?? c).join('') : styled;
  });
}

/** Single letters spelled out with separators: s.e.x, p|o|r|n and s e x rejoin; ordinary words never lose their spacing.
 *  The run must follow a non-letter, consumed and put back rather than asserted with lookbehind, which
 *  Safari gained only in 16.4. */
export function joinSpelledLetters(text: string): string {
  return text.replace(/(^|[^\p{L}])((?:\p{L}[\p{P}\p{S}\s]{1,2}){2,}\p{L})(?!\p{L})/gu, (_, lead: string, run: string) => lead + run.replace(/[\p{P}\p{S}\s]+/gu, ''));
}

/** Digits and symbols standing in for letters, only inside tokens that also contain letters: s3x and n1gger, never 3080 or 3D. */
function foldLeet(text: string): string {
  return text.replace(/[\p{L}\p{N}@$!]+/gu, token => /\p{L}/u.test(token) && /\p{L}.*[\p{N}@$!]|[\p{N}@$!].*\p{L}/su.test(token) && !/\p{Script=Han}/u.test(token) ? [...token].map(c => LEET[c] ?? c).join('') : token);
}

/** Analysis views of one normalized text: Han views join separators and single fillers (甲*乙*丙, 甲a乙a丙), Latin views fold look-alike, spelled-out, leet and stretched letters; the original text is never rewritten. */
export function analysisVariants(original: string, normalized: string): Set<string> {
  const joined = normalized.replace(/(\p{Script=Han})\p{M}+/gu, '$1')
    .replace(/(\p{Script=Han})[\p{P}\p{Z}\p{S}\s]+(?=\p{Script=Han})/gu, '$1')
    .replace(/(\d)[\p{P}\p{Z}\s]+(?=\d)/gu, '$1');
  // Three or more copies are an analysis view; ordinary doubled letters remain intact.
  const repeated = joined.replace(/([\p{Script=Han}\d])\1{2,}/gu, '$1');
  const filled = repeated.replace(/(\p{Script=Han})(?!\p{Script=Han})[\p{L}\p{N}](?=\p{Script=Han})/gu, '$1');
  const latin = joinSpelledLetters(foldScripts(normalized));
  const leet = foldLeet(latin);
  const stretched = latin.replace(/(\p{Script=Latin})\1+/gu, '$1');
  const variants = new Set([normalized, joined, repeated, filled, latin, leet, stretched]);
  // A directional override displays text reversed; the stored order hides the phrase from every forward view.
  if (DIRECTION.test(original)) for (const variant of [...variants]) variants.add([...variant].reverse().join(''));
  variants.delete('');
  return variants;
}
