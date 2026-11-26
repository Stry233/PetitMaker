/**
 * Right-edge layer, history, and view controls. `frame-plan.ts` owns their responsive placement,
 * including folded layouts and room for the layer panel. Hover labels open toward the map without
 * moving their button targets; zoom and rotation controls repeat while held.
 */
import { ViewKit } from './controls/RailViewKit';
import { HistoryGroup } from './controls/RailHistory';
import { LayerControl } from './controls/RailLayerControl';
import { sessionOffers } from '../../state/session-offer';
import { useFramePose } from '../session/use-frame-pose';
import { LayerPanel } from './controls/LayerPanel';
import { useRef } from 'react';
import { FrameLayoutProvider, useFrameLayout, useLiveRail, useLiveRailWriter, type LayoutState } from './frame-layout';

export function Rail({ hidden, onHide }: { hidden: boolean; onHide: () => void }) {
  const layout = useFrameLayout();
  if (!layout) return <FrameLayoutProvider><Rail hidden={hidden} onHide={onHide} /></FrameLayoutProvider>;
  return <PlannedRail layout={layout} hidden={hidden} onHide={onHide} />;
}

function PlannedRail({ layout, hidden, onHide }: { layout: LayoutState; hidden: boolean; onHide: () => void }) {
  const pose = useFramePose();
  // A session that offers no layer command keeps the layer control and its panel away.
  const layers = sessionOffers(pose, 'view.layer_visible');
  // A scale glide re-plans the rail at the live room, as the settled plan would on each of its frames.
  const plan = useLiveRail(layout);
  const kitRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  useLiveRailWriter(layout, plan, kitRef, historyRef);
  const { layerMode: mode, setLayerMode: setMode } = layout;
  return (
    <>
      <LayerControl panelOpen={mode !== 'pill'} onOpen={() => setMode('column')} veiled={hidden || !layers} />
      {/* A sibling of the three groups, not a child of the one it replaces. A group carries a
          z-index, so it is a stacking context, and a plate nested inside one is ordered against its
          siblings inside it however high its own z-index is: the buttons of the next group along
          then painted over the plate, and cut through the tiles at its right edge. */}
      <LayerPanel
        mode={mode}
        onMode={setMode}
        right={plan.plateRight}
        top={layout.plateTop}
        maxWidth={layout.plateMaxWidth}
        maxHeight={plan.plateMaxH}
        veiled={hidden || !layers}
      />
      <HistoryGroup boxRef={historyRef} top={plan.historyTop} right={layout.edgeRight + plan.historyInset} files={plan.historyFiles}
        veiled={hidden} />
      <ViewKit boxRef={kitRef} plan={plan} right={layout.edgeRight} hidden={hidden} onHide={onHide} pose={pose} />
    </>
  );
}