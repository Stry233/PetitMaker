/*
 * The type ladder `ui/design/text-weight.ts:TEXT_ROLES` keeps its ranks apart enough to read as ranks.
 */
import { describe, it, expect } from 'vitest';
import { TEXT_ROLES, type TextRole } from '../../../ui/design/text-weight';

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
