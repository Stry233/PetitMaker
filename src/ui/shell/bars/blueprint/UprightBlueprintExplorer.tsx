/**
 * The upright Blueprint panel unfolded, under its head of folder tabs: a row with the view switch (and
 * Select under touch) over the cards in two columns or the one-line list.
 */
import { useRef } from 'react';
import { useTouchMode } from '../../../design/input-mode';
import { SPACE } from '../../../design/styles';
import { useScrollRow } from '../../../primitives/use-scroll-row';
import { useFrameZoom } from '../../use-frame-zoom';
import { UPRIGHT_GRID } from '../objects/object-shelf';
import { ExplorerView, headFamily, PickButton, VIEW_BLEED, ViewSwitch } from './BlueprintExplorer';
import { ExportButton } from './blueprint-asks';
import { BLUEPRINT_CARD_ASPECT } from './BlueprintCard';
import { usePieces, type BlueprintShelfModel } from './use-blueprint-shelf';

/** The view row's depth with a mouse and the gap between the explorer's rows, in css px. */
const STATUS_H = SPACE[13];
const ROW_GAP = SPACE[6];

/** The columns the upright cards stand in. */
const COLUMNS = 2;

/** The least the upright explorer works in, under the panel's head, for a room `room` css px wide: its
 *  view row, a fingertip deep in touch mode, and one row of cards with their chosen rings' room. */
export function uprightExplorerLeast(room: number, touch: boolean): number {
  const card = (room - (COLUMNS - 1) * UPRIGHT_GRID.gap) / COLUMNS / BLUEPRINT_CARD_ASPECT;
  return headFamily(STATUS_H, touch).size + ROW_GAP + card + 2 * VIEW_BLEED;
}

export function UprightBlueprintExplorer({ model }: { model: BlueprintShelfModel }) {
  const piece = usePieces();
  const touch = useTouchMode();
  const zoom = useFrameZoom();
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsFade = useScrollRow(toolsRef, { zoom, pointerEvents: 'auto' });
  const { size, gap } = headFamily(STATUS_H, touch);
  return (
    <div data-testid="blueprint-explorer" style={{ display: 'flex', flexDirection: 'column', gap: ROW_GAP, flex: '1 1 auto', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', height: size, flex: 'none', minWidth: 0 }}>
        {/* The row's controls scroll on a narrow window. */}
        <div ref={toolsRef} className="pw-noscroll" style={{ display: 'flex', flex: '0 1 auto', minWidth: 0, marginInlineStart: 'auto', ...toolsFade }}>
          <div style={{ display: 'flex', alignItems: 'center', gap, flex: 'none' }}>
            {touch ? <PickButton model={model} size={size} piece={piece} /> : null}
            <ExportButton model={model} size={size} piece={piece('export')} />
            <ViewSwitch model={model} height={size} piece={piece} />
          </div>
        </div>
      </div>
      <ExplorerView model={model} columns={COLUMNS} gap={UPRIGHT_GRID.gap} upright piece={piece} style={{ flex: '1 1 auto' }} />
    </div>
  );
}
