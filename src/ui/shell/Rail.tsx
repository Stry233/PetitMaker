/**
 * Right-edge layer, history, and view controls. `planRail` owns their responsive placement,
 * including folded layouts and room for the layer panel. Hover labels open toward the map without
 * moving their button targets; zoom and rotation controls repeat while held.
 */
import { ViewKit } from './controls/RailViewKit';
import { HistoryGroup } from './controls/RailHistory';
import { LayerControl } from './controls/RailLayerControl';
import { useEditorStore } from '../../state/store';
import { LayerPanel } from './controls/LayerPanel';
import { FrameLayoutProvider, useFrameLayout } from './frame-layout';

export function Rail({ hidden, onHide }: { hidden: boolean; onHide: () => void }) {
  const layout = useFrameLayout();
  const session = useEditorStore((s) => s.planetSession !== null);
  if (!layout) return <FrameLayoutProvider><Rail hidden={hidden} onHide={onHide} /></FrameLayoutProvider>;
  const { layerMode: mode, setLayerMode: setMode, rail: plan } = layout;
  return (
    <>
      <LayerControl panelOpen={mode !== 'pill'} onOpen={() => setMode('column')} veiled={hidden || session} />
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
        veiled={hidden || session}
      />
      <HistoryGroup top={plan.historyTop} right={layout.edgeRight} files={plan.historyFiles}
        placement={`${plan.kitFiles}:${plan.historyFiles}:${layout.cornerTop}`} veiled={hidden} />
      <ViewKit plan={plan} right={layout.edgeRight} hidden={hidden} onHide={onHide} session={session} />
    </>
  );
}