/**
 * `uprightCardFit` lays the upright grid's cards across its room with one fixed gap: the columns and
 * the gaps between them fill the room exactly, and the column count is the one whose cards come
 * nearest their own size, so the width left over never widens a gap.
 */
import { describe, expect, it } from 'vitest';
import { spec } from '../../../../_support/spec';
import { UPRIGHT_GRID, uprightCardFit } from '../../../../../ui/shell/bars/objects/object-shelf';

describe('uprightCardFit', () => {
  spec('UI-28', 'the cards fill the room with one fixed gap, the leftover going to the cards', () => {
    const { gap, minColumns } = UPRIGHT_GRID;
    for (let room = 160; room <= 1200; room += 7) {
      for (const card of [60, 99, 140]) {
        const at = `${room} ${card}`;
        const { columns, fit } = uprightCardFit(room, card);
        expect(columns, at).toBeGreaterThanOrEqual(minColumns);
        // The cards at their fitted size and the fixed gaps fill the room: nothing is left over.
        expect(columns * card * fit + (columns - 1) * gap, at).toBeCloseTo(room, 6);
        // At their own size, the cards leave less than half a column and its gap over or short, so
        // no other count brings them nearer their size.
        if (columns > minColumns) expect(Math.abs(columns * (card + gap) - gap - room), at).toBeLessThanOrEqual((card + gap) / 2 + 1e-9);
        else expect(columns * (card + gap) - gap - room, at).toBeGreaterThanOrEqual(-(card + gap) / 2 - 1e-9);
      }
    }
  });

  it('grows the cards by less than half a column and its gap shared among the columns', () => {
    for (let room = 160; room <= 1200; room += 7) {
      const { columns, fit } = uprightCardFit(room, 99);
      expect(fit).toBeLessThanOrEqual(1 + (99 + UPRIGHT_GRID.gap) / 2 / columns / 99 + 1e-9);
    }
  });
});
