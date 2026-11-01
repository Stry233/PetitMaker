/*
 * The selection's own surfaces over a Help figure's map, on the figure's world: the selection card
 * where the live editor stands it, and touch multi-select's plate and row while the world's latch is
 * on, which is when the live card gives way to them. Both are the live components, pictured.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SelectionCard, type SelectionCardSource } from '../../chrome/floating/SelectionCard';
import { PicturedMultiSelect } from '../../shell/bars/selection/MultiSelectBar';
import { selectedObjectIds } from '../../../state/selection';
import { PAN_ROW_ATTR, type DemoMap } from './demo-player';
import { figureShare } from './figure-scale';

/** The clear air the card keeps from the box's sides, in px (`selection-card-layout.ts`), which the
 *  multi-select row keeps too. */
const CARD_MARGIN = 8;
/** The multi-select row's box, which the player pans toward the tile the finger heads for. */
const ROW_ATTRS = { [PAN_ROW_ATTR]: '0' };

/** `map`'s selection surfaces in a box `W` by `H + barH`, the map clear above the bar's `barH`; the
 *  multi-select surfaces draw at the frame's `zoom`. */
export function PicturedSelection({ map, W, H, barH, zoom }: { map: DemoMap; W: number; H: number; barH: number; zoom: number }) {
  const [revision, setRevision] = useState(0);
  const fit = useCallback((least: number) => figureShare(W - 2 * CARD_MARGIN, least).share, [W]);
  useEffect(() => map.onSelection(() => setRevision((n) => n + 1)), [map]);
  const watch = useMemo(() => (tell: (cause?: string) => void) => {
    const offCamera = map.watch(tell);
    const offSelection = map.onSelection(tell);
    return () => { offCamera(); offSelection(); };
  }, [map]);
  const source = useMemo<SelectionCardSource>(() => ({
    read: map.selection,
    view: map.view,
    frame: () => ({ viewport: { width: W, height: H + barH }, area: { left: 0, top: 0, right: W, bottom: H } }),
    watch,
    revision,
    share: fit,
  }), [map, W, H, barH, watch, revision, fit]);
  const { selection, latched } = map.selection();
  return (
    <>
      <SelectionCard source={source} />
      {latched && <PicturedMultiSelect count={selectedObjectIds(selection).length} zoom={zoom} share={fit} rowAttrs={ROW_ATTRS} />}
    </>
  );
}
