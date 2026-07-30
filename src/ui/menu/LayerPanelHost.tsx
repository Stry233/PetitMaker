/*
 * LayerPanelHost — owns the layer panel's data wiring so that painting re-renders
 * ONLY the panel, not the whole App tree. It subscribes to `cells-changed` itself
 * and recomputes the (whole-grid) layer statistics via getActiveLayers only when
 * cells actually change or the active/display layer moves — instead of App
 * re-running that O(width×height) scan in its render body on every store change.
 */
import { useEffect, useMemo, useState } from 'react';
import { useEditorStore } from '../../state/store';
import { getActiveLayers } from '../../core/model/layer-utils';
import { LayerPanel } from './LayerPanel';

export function LayerPanelHost() {
  const gridState = useEditorStore((s) => s.gridState);
  const activeLayer = useEditorStore((s) => s.activeLayer);
  const displayLayer = useEditorStore((s) => s.displayLayer);
  const layerVisibility = useEditorStore((s) => s.layerVisibility);
  const layerLocked = useEditorStore((s) => s.layerLocked);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const setLayerVisibility = useEditorStore((s) => s.setLayerVisibility);
  const setLayerLocked = useEditorStore((s) => s.setLayerLocked);
  const eventBus = useEditorStore((s) => s.eventBus);

  // Cells mutate in place, so we can't key off gridState identity — bump a tick
  // on cells-changed and let the memo below recompute. The event fires once per
  // COMMAND (a brush stroke issues dozens), so coalesce bumps to one per frame:
  // the whole-grid getActiveLayers scan + panel render happen at most once per
  // paint, and only the final per-frame state is ever visible anyway.
  const [cellsTick, setCellsTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onCellsChanged = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; setCellsTick((t) => t + 1); });
    };
    eventBus.on('cells-changed', onCellsChanged);
    return () => {
      eventBus.off('cells-changed', onCellsChanged);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [eventBus]);

  const highlightLayer = displayLayer ?? activeLayer;
  const layers = useMemo(
    () => (gridState ? getActiveLayers(gridState, Math.max(activeLayer, highlightLayer)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cellsTick stands in for in-place cell mutations
    [gridState, activeLayer, highlightLayer, cellsTick],
  );

  if (!gridState) return null;

  return (
    <LayerPanel
      layers={layers}
      activeLayer={activeLayer}
      highlightLayer={highlightLayer}
      layerVisibility={layerVisibility}
      layerLocked={layerLocked}
      onSelectLayer={setActiveLayer}
      onToggleVisibility={(e) => setLayerVisibility(e, layerVisibility[e] === false)}
      onToggleLock={(e) => setLayerLocked(e, !layerLocked[e])}
    />
  );
}
