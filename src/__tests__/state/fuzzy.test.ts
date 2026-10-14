import { describe, it, expect } from 'vitest';
import { fuzzyScore, tierAndBonus, MAX_BONUS } from '../../state/fuzzy';

describe('fuzzyScore', () => {
  it('is case-insensitive', () => {
    expect(fuzzyScore('APPLE', 'apple tree')).toBe(fuzzyScore('apple', 'apple tree'));
  });

  it('is full-width-insensitive (NFKC folds it to the same query)', () => {
    expect(fuzzyScore('ｓａｋｕｒａ', 'sakura tree')).toBe(fuzzyScore('sakura', 'sakura tree'));
  });

  it('is diacritic-insensitive', () => {
    expect(fuzzyScore('cafe', 'Café Flower')).not.toBeNull();
  });

  it('matches nothing when a query letter never appears at all', () => {
    expect(fuzzyScore('xyz', 'Apple Tree')).toBeNull();
  });

  it('ranks a whole-string match above a mid-word substring above a scattered (typo) match', () => {
    const candidate = 'Apple Tree';
    const whole = fuzzyScore('apple tree', candidate)!;
    const wordStart = fuzzyScore('apple', candidate)!;
    // 'ple' is a literal substring of 'Apple' but starts mid-word.
    const midWord = fuzzyScore('ple', candidate)!;
    // 'aple' (one 'p' dropped) is not a literal substring of 'Apple' at all — subsequence only.
    const typo = fuzzyScore('aple', candidate)!;
    expect(whole).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(midWord);
    expect(midWord).toBeGreaterThan(typo);
    expect(typo).not.toBeNull();
  });

  it('a word-start substring outranks a mid-word one of the same query', () => {
    expect(fuzzyScore('cat', 'Cat Tower')!).toBeGreaterThan(fuzzyScore('cat', 'Concatenate')!);
  });

  it('a literal (contiguous) match always outranks a scattered one, any candidates', () => {
    // 'cat' is a literal mid-word substring of 'concatenate' but only a scattered subsequence of
    // 'cool available tea' (c...a...t, three separate runs).
    expect(fuzzyScore('cat', 'concatenate')!).toBeGreaterThan(fuzzyScore('cat', 'cool available tea')!);
  });

  it('within a scattered match, fewer/longer contiguous runs score higher', () => {
    // Neither candidate contains 'abcd' as a literal substring, so both fall to the subsequence
    // tier; the first keeps 'ab' and 'cd' each touching (one gap), the second breaks every letter.
    const tighter = fuzzyScore('abcd', 'abXXcd')!;
    const scattered = fuzzyScore('abcd', 'aXbXcXd')!;
    expect(tighter).toBeGreaterThan(scattered);
  });

  it('subsequence-matches a CJK query that drops a character, in order', () => {
    // The query (apple + tree) omits the fruit character from the name (apple tree), a real
    // abbreviation a visitor might type, but is not itself a substring anywhere in it.
    expect(fuzzyScore('苹果树', '苹果树')).not.toBeNull(); // sanity: exact still matches
    expect(fuzzyScore('苹树', '苹果树')).not.toBeNull();
    expect(fuzzyScore('苹果树', '苹果树')!).toBeGreaterThan(fuzzyScore('苹树', '苹果树')!);
  });

  it('does not subsequence-match CJK characters out of order or absent entirely', () => {
    expect(fuzzyScore('树苹', '苹果树')).toBeNull(); // right characters, wrong order
    expect(fuzzyScore('苹树', '桃花树')).toBeNull(); // the tree character is present, the apple character is not
  });

  it('a parenthesised nickname counts as its own word', () => {
    // The catalog embeds a building's in-world character name in parentheses, as in the bamboo
    // cabin below. The full-width opening paren is a separator, so the nickname inside it reads as
    // a fresh word.
    const wordStart = fuzzyScore('云果', '竹果丰年小屋（云果）')!;
    // The fruit character is buried mid-word earlier in the string, never at a boundary.
    const midWord = fuzzyScore('果丰', '竹果丰年小屋（云果）')!;
    expect(wordStart).toBeGreaterThan(midWord);
  });
});

describe('tierAndBonus', () => {
  it('splits a score back into its tier floor and a bonus within range', () => {
    const score = fuzzyScore('apple', 'Apple Tree')!;
    const { tier, bonus } = tierAndBonus(score);
    expect(tierAndBonus(tier), 'the floor is a tier of its own').toEqual({ tier, bonus: 0 });
    expect(bonus).toBeGreaterThanOrEqual(0);
    expect(bonus).toBeLessThanOrEqual(MAX_BONUS);
    expect(tier + bonus).toBe(score);
  });
});
