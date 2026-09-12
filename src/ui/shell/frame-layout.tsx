import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useDockRef, useViewportSize } from '../design/scale';
import { useAnimatedUiZoom } from '../design/ui-zoom-anim';
import { useUiPreviewPose } from '../primitives/ui-preview';
import { planFrame, railClearanceFor, type FrameLayout, type LayerMode } from './frame';
import { useFrameZoom } from './use-frame-zoom';
import { PLATE_MIN_WIDTH, plateDepth, plateMinDepth } from './windows/LayerPanel';
import { ZOOM } from './units';
import { useDockStage } from './use-dock';
import { frameZoomAt, PINNED_COLUMN_W } from './panel-frame';

interface LayoutState extends FrameLayout {
  layerMode: LayerMode;
  setLayerMode: (mode: LayerMode) => void;
}

const FrameLayoutContext = createContext<LayoutState | null>(null);

export function useFrameLayout(): LayoutState | null {
  return useContext(FrameLayoutContext);
}

export function useRailClearance(bottom: number, height: number): number {
  const layout = useFrameLayout();
  return layout ? railClearanceFor(layout, bottom, height) : 0;
}

/** One plan for the corner actions, rail and bottom rows in the remaining workspace. */
export function FrameLayoutProvider({ children }: { children: ReactNode }) {
  const pose = useUiPreviewPose();
  const [layerMode, setLayerMode] = useState<LayerMode>(pose?.layerPanel ?? 'pill');
  const viewport = useViewportSize();
  const zoom = useFrameZoom();
  const dock = useDockRef();
  const { aside } = useDockStage();
  const uiZoom = useAnimatedUiZoom();
  let width = viewport.w / zoom - dock / ZOOM;
  let height = viewport.h / zoom;
  // Reserve the tighter endpoint during a slide without subscribing React to its individual frames.
  if (aside > 0 && aside < 1) {
    const free = frameZoomAt(0, viewport.w, viewport.h, uiZoom);
    const pinned = frameZoomAt(1, viewport.w, viewport.h, uiZoom);
    width = Math.min(viewport.w / free, viewport.w / pinned - PINNED_COLUMN_W);
    height = Math.min(viewport.h / free, viewport.h / pinned);
  }
  const value = useMemo(() => ({
    ...planFrame(width, height, { open: layerMode !== 'pill', plateDepth: plateDepth(layerMode), plateMinDepth: plateMinDepth(layerMode), plateMinWidth: PLATE_MIN_WIDTH }),
    layerMode, setLayerMode,
  }), [width, height, layerMode]);
  return <FrameLayoutContext.Provider value={value}>{children}</FrameLayoutContext.Provider>;
}
