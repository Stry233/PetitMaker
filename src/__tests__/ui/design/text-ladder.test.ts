/*
 * A type size is named, not chosen: a number written into a style object lets one rank drift to a
 * different size in every window. `ui/design/text-weight.ts:TEXT_ROLES` is the inventory, the homes
 * below may hold a number, and `text-ladder-allowlist.json` names each exception with its reason.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TEXT_ROLES, type TextRole } from '../../../ui/design/text-weight';
import { repoFiles } from '../../_support/source-graph';
import ALLOWLIST from './text-ladder-allowlist.json';

function sources(dir: string): { path: string; text: string }[] {
  return repoFiles(dir).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
}

/**
 * The files that may hold a type size: the ladder, the two token sets that publish it, and the frame's
 * own ladder (`units.ts`), authored against `units.ts:ZOOM` times the chrome's factor.
 */
const HOMES = [
  'src/ui/design/text-weight.ts',
  'src/ui/design/styles.ts',
  'src/ui/design/window-skin.ts',
  'src/ui/shell/units.ts',
];

/**
 * Sizes that are legitimately local, each with its reason. A size derived from a caller's own
 * dimension (`Math.round(size * 0.42)` in `BrandLockup`) needs no entry: the scan does not read it.
 */
const ALLOWED: Readonly<Record<string, string>> = ALLOWLIST;

/** A size given as a bare number: `fontSize:`, the `fontSize={...}` prop, and the kebab-case
 *  `font-size:` inside an injected `<style>` string. */
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

  /** A stale entry would hide the next stray in that file. */
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

/** The rungs a window's titled text may stand on. */
const HEADING_RUNGS: TextRole[] = ['title', 'lead', 'head', 'subhead'];

describe('the heading rungs', () => {
  it('separates each rank from the next by enough to read as a rank', () => {
    const sizes = HEADING_RUNGS.map((r) => TEXT_ROLES[r].px);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i], `${HEADING_RUNGS[i]} does not sit below ${HEADING_RUNGS[i - 1]}`)
        .toBeLessThan(sizes[i - 1]!);
      // Under about 2px two headings read as one rank set unevenly.
      expect(sizes[i - 1]! - sizes[i]!, `${HEADING_RUNGS[i]} is too close to ${HEADING_RUNGS[i - 1]}`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  /** `subhead` sits one px from the rows it heads, so weight carries its rank. */
  it('gives the innermost heading the heaviest weight on its card', () => {
    expect(TEXT_ROLES.subhead.weight).toBeGreaterThan(TEXT_ROLES.body.weight);
    expect(TEXT_ROLES.subhead.weight).toBeGreaterThan(TEXT_ROLES.chip.weight);
    expect(TEXT_ROLES.subhead.px).toBeGreaterThanOrEqual(TEXT_ROLES.caption.px);
  });

  it('sets body copy and an input at one size, so a field matches the prose round it', () => {
    expect(TEXT_ROLES.field.px).toBe(TEXT_ROLES.body.px);
  });
});

/** `note` keeps a surface's own prose above `caption`, the floor reserved for tabular counts. */
describe('the prose rung', () => {
  it('stands above the small print, and below the label it is not', () => {
    expect(TEXT_ROLES.note.px).toBeGreaterThan(TEXT_ROLES.caption.px);
    expect(TEXT_ROLES.note.px).toBeGreaterThan(TEXT_ROLES.small.px);
    expect(TEXT_ROLES.note.px).toBeLessThan(TEXT_ROLES.label.px);
  });

  /** It sits half a pixel over `chip`, since prose and a pill share a row; weight carries the rank. */
  it('is lighter than the pill it sits beside', () => {
    expect(TEXT_ROLES.note.px - TEXT_ROLES.chip.px).toBeLessThanOrEqual(1);
    expect(TEXT_ROLES.note.weight).toBeLessThan(TEXT_ROLES.chip.weight);
  });
});
