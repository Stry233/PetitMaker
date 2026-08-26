/*
 * A SIZE IS NAMED, NOT CHOSEN.
 *
 * Modelled on `__tests__/core/prefs.test.ts` (a storage key written outside its one table) and
 * `__tests__/ui/shell/motion-registry.test.ts` (a curve chosen at a call site). The same argument
 * carries: a number written into a style object is a decision nobody can find later, and it is how
 * one semantic level came to be set at six different sizes across the windows — a section heading at
 * 12/700, 12.5/800, 13/900, 15/800, 15/900 and 16/700, each defensible where it stood and none of
 * them the same rank on the glass as its neighbour.
 *
 * `ui/design/text-weight.ts:TEXT_ROLES` is the inventory. The homes below are the files allowed to
 * hold a number, and `ALLOWED` names every survivor with the reason it is one, so the exceptions are
 * documented rather than merely absent.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { TEXT_FLOOR, TEXT_ROLES, type TextRole } from '../../../ui/design/text-weight';

function sources(dir: string): { path: string; text: string }[] {
  return (readdirSync(dir) as string[]).flatMap((name) => {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [{ path: full, text: readFileSync(full, 'utf8') }] : [];
  });
}

/**
 * The files that may hold a type size: the ladder itself, the two token sets that publish it, and
 * the frame's own fixed-px ladder (`units.ts`), which is a SECOND declared system rather than a
 * stray — the frame draws at `units.ts:ZOOM` times the chrome's factor, so its numbers are authored
 * against a different multiplier and cannot be pooled with the chrome's.
 */
const HOMES = [
  'src/ui/design/text-weight.ts',
  'src/ui/design/styles.ts',
  'src/ui/design/window-skin.ts',
  'src/ui/shell/units.ts',
];

/**
 * A size that is legitimately local, each with the reason it is not a rung. A run of TITLED text
 * never belongs here: what is left is glyphs measured against the art they centre in, one platform
 * requirement, and one surface that does not ship.
 *
 * A size DERIVED from a caller's own dimension (`Math.round(size * 0.42)` in `BrandLockup`, the
 * map-anchored marks, `bar-atoms`' `size` prop) needs no entry — it is not a number chosen for a
 * run of text, and the scan below does not read it as one.
 */
const ALLOWED: Record<string, string> = {
  'src/ui/shell/bars/CandidateCard.tsx': 'iOS Safari zooms the page in on focus for any input under 16px',
  'src/ui/chrome/modals/export/Shot3dStrip.tsx': 'two glyphs (a placeholder frame, a plus) sized to the tile they centre in',
  'src/ui/chrome/modals/export/ExportPreview.tsx': 'the failed-preview pictograph is an illustration, not a line of type',
  'src/ui/chrome/modals/export/Preview3D.tsx': 'a glyph centred in a 46px round button',
  'src/ui/chrome/modals/AboutModal.tsx': 'the grid row\'s chevron is a mark sized to the row, not a word in it',
  // ui/hints has no place to stand in the frame yet. Its numbers are the retired panel's; they
  // are pinned here so restoring it has to answer for them.
  'src/ui/hints/tokens.tsx': 'the Quick Hints panel is built but unmounted',
  'src/ui/hints/HintPanel.tsx': 'the Quick Hints panel is built but unmounted',
};

/**
 * A size given as a bare number: `fontSize:`, the `fontSize={...}` prop form, and the kebab-case
 * `font-size:` a surface writes inside an injected `<style>` string. The kebab form is the one the
 * ladder found strays in — a stylesheet built as a template literal reads as prose to every editor
 * search, so a size written there is the hardest kind to find.
 */
const RAW_SIZE = /fontSize(:|=\{)\s*-?\d|font-size\s*:\s*-?\d/;

describe('the type ladder is the only inventory of sizes', () => {
  it('names a size at every call site under ui/, or says why it does not', () => {
    const offenders = sources('src/ui')
      .filter(({ path }) => !HOMES.includes(path))
      .filter(({ path }) => !(path in ALLOWED))
      .flatMap(({ path, text }) => text.split('\n').flatMap((line, i) => (
        RAW_SIZE.test(line) ? [`${path}:${i + 1} ${line.trim().slice(0, 120)}`] : []
      )));
    expect(offenders).toEqual([]);
  });

  /** An allowlist that outlives its entry stops documenting anything and starts hiding the next one. */
  it('keeps no allowlist entry that has nothing left to excuse', () => {
    const stale = Object.keys(ALLOWED).filter((path) => {
      const text = readFileSync(path, 'utf8') as string;
      return !text.split('\n').some((line) => RAW_SIZE.test(line));
    });
    expect(stale).toEqual([]);
  });

  it('gives every allowlist entry a reason', () => {
    for (const [path, why] of Object.entries(ALLOWED)) {
      expect(why.trim().length, `${path} is excused without a reason`).toBeGreaterThan(10);
    }
  });
});

/**
 * The rungs a WINDOW's titled text may stand on. A window title, a section heading and a card header
 * are three ranks and no more: the mandate this ladder answers was that the same rank read at a
 * different size depending on which window it was in.
 */
const HEADING_RUNGS: TextRole[] = ['title', 'lead', 'head', 'subhead'];

describe('the heading rungs', () => {
  it('separates each rank from the next by enough to read as a rank', () => {
    const sizes = HEADING_RUNGS.map((r) => TEXT_ROLES[r].px);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i], `${HEADING_RUNGS[i]} does not sit below ${HEADING_RUNGS[i - 1]}`)
        .toBeLessThan(sizes[i - 1]!);
      // Under about 2px two headings read as one rank set slightly unevenly, which is the drift
      // this ladder replaced rather than a hierarchy.
      expect(sizes[i - 1]! - sizes[i]!, `${HEADING_RUNGS[i]} is too close to ${HEADING_RUNGS[i - 1]}`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  /** `subhead` sits two px from the rows it heads, so weight is the only rank it has left. */
  it('gives the innermost heading the heaviest weight on its card', () => {
    expect(TEXT_ROLES.subhead.weight).toBeGreaterThan(TEXT_ROLES.body.weight);
    expect(TEXT_ROLES.subhead.weight).toBeGreaterThan(TEXT_ROLES.chip.weight);
    expect(TEXT_ROLES.subhead.px).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });

  it('sets body copy and an input at one size, so a field matches the prose round it', () => {
    expect(TEXT_ROLES.field.px).toBe(TEXT_ROLES.body.px);
  });
});

/**
 * PROSE IS NOT SMALL PRINT, and for a long time the ladder had no way to say so: with no `note`
 * rung, every sentence a surface said in its own voice landed on `caption` — the rung reserved for a
 * tabular count, and the floor of the whole ladder. The agent panel's most-read text and its
 * smallest figures were drawn at one size and told apart by nothing.
 */
describe('the prose rung', () => {
  it('stands above the small print, and below the label it is not', () => {
    expect(TEXT_ROLES.note.px).toBeGreaterThan(TEXT_ROLES.caption.px);
    expect(TEXT_ROLES.note.px).toBeGreaterThan(TEXT_ROLES.small.px);
    expect(TEXT_ROLES.note.px).toBeLessThan(TEXT_ROLES.label.px);
  });

  /** It sits half a pixel over `chip` because prose and a pill share a row and must not step; the
   *  rank between them is the WEIGHT, as it is everywhere else two rungs nearly share a size. */
  it('is lighter than the pill it sits beside', () => {
    expect(TEXT_ROLES.note.px - TEXT_ROLES.chip.px).toBeLessThanOrEqual(1);
    expect(TEXT_ROLES.note.weight).toBeLessThan(TEXT_ROLES.chip.weight);
  });
});
