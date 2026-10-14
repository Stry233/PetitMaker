/**
 * `host.feedback.flash` is what the agent's write acknowledgement goes through
 * (`agent/exec/tool-deps.ts`'s `onFlash`). Every caller names the grid of each set it flashes, and
 * the host hands the sets to the live overlay unchanged.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { host } from '../../../editor/host/host';
import { setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import type { CellSet } from '../../../core/grid/grids';
import { cellSet } from '../../../core/grid/grids';

type Flashed = { sets: readonly CellSet[]; opts?: { color?: number } };

function install(): Flashed[] {
  const seen: Flashed[] = [];
  setActiveView({
    overlay: { flashCommit: (sets: Flashed['sets'], opts?: Flashed['opts']) => { seen.push({ sets, opts }); } },
  } as unknown as ActiveView);
  return seen;
}

afterEach(() => { setActiveView(null); });

describe('host.feedback.flash', () => {
  it('passes each set on its stated grid straight through, cells untouched', () => {
    const seen = install();
    const sets: CellSet[] = [cellSet('terrain', [{ x: 1, y: 1 }]), cellSet('object', [{ x: 5, y: 6 }, { x: 6, y: 6 }])];
    host.feedback.flash(sets, { color: 0x123456 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.sets).toEqual(sets);
    expect(seen[0]!.opts).toEqual({ color: 0x123456 });
  });

  it('is a no-op with no view', () => {
    const seen = install();
    setActiveView(null);
    host.feedback.flash([cellSet('terrain', [{ x: 1, y: 1 }])]);
    expect(seen).toHaveLength(0);
  });
});
