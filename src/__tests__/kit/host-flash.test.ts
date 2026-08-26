/**
 * `host.feedback.flash` is the one caller that hands the overlay a bare cell list — it is what the
 * agent's write acknowledgement goes through (`ui/agent/panel-runner.ts`'s `onFlash`), and ONE such list mixes
 * terrain cells from a terraform call with the bodies a place/scatter just landed. No single
 * `terrainMode` is right for it, so the host resolves each cell against the live map instead. A
 * caller that DOES state a grid keeps it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { host } from '../../kit/host';
import { setActiveView } from '../../canvas/active-view';
import type { ActiveView } from '../../canvas/view-projection';
import { useEditorStore } from '../../state/store';
import { registerCatalogItem } from '../../state/catalog';
import { ItemCategory, type GridState, type MacroCoord, type PlacedObject } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

registerCatalogItem({
  id: 'host-flash-house', category: ItemCategory.Building, name: { en: 'Host Flash House' },
  width: 2, height: 1, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
});

type Flashed = { cells: readonly (MacroCoord & { micro?: boolean })[]; opts?: { terrainMode?: boolean } };

function install(): { seen: Flashed[]; gs: GridState } {
  const seen: Flashed[] = [];
  setActiveView({
    overlay: { flashCommit: (cells: Flashed['cells'], opts?: Flashed['opts']) => { seen.push({ cells, opts }); } },
  } as unknown as ActiveView);
  const gs = makeState(30, 30) as GridState;
  const house: PlacedObject = {
    id: 'h', catalogId: 'host-flash-house', position: { x: 5, y: 6 }, rotation: 0, elevation: 0,
  };
  gs.objects.set(house.id, house);
  useEditorStore.setState({ gridState: gs });
  return { seen, gs };
}

afterEach(() => { setActiveView(null); });

describe('host.feedback.flash', () => {
  it('resolves an unlabelled list per cell: terrain on the micro grid, a body on the macro grid', () => {
    const { seen } = install();
    host.feedback.flash([{ x: 1, y: 1 }, { x: 5, y: 6 }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.cells).toEqual([
      { x: 1, y: 1, micro: true },                                  // bare ground
      { x: 5, y: 6, micro: false }, { x: 6, y: 6, micro: false },   // the body it landed, whole
    ]);
  });

  it('passes a stated grid straight through, cells untouched', () => {
    const { seen } = install();
    host.feedback.flash([{ x: 5, y: 6 }], { terrainMode: true });
    expect(seen[0]!.cells).toEqual([{ x: 5, y: 6 }]);
    expect(seen[0]!.opts).toEqual({ terrainMode: true });
  });

  it('is a no-op with no view, and passes the list on when there is no map to read', () => {
    const { seen } = install();
    setActiveView(null);
    host.feedback.flash([{ x: 1, y: 1 }]);
    expect(seen).toHaveLength(0);
  });
});
