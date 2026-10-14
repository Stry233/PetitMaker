/**
 * A planet on the export preview's stage: drag to pan, wheel to zoom, double-click to reset. The
 * picture is repainted through `paintPlanet` for every view rather than scaled as an image, so it
 * stays crisp at any zoom. At rest the land fills the stage less an equal margin, centred. The
 * planet's name and size stand over the picture's top-left corner in the map's own label treatment,
 * on a corner wash; an optional toolbar stands at the top right.
 */
import { useGridRevision } from '../../../session/use-map-derived';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { type GridState, type MacroCoord, type MapTemplate } from '../../../../core/model/types';
import { paintPlanet, type CellExtent } from '../../../../view/map2d/capture/planet-painter';
import { Spinner } from '../../../primitives/Spinner';
import { radii } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { CORNER_VIGNETTE, MAP_LABEL, SEA } from '../../../design/tokens';
import { visualRect } from '../../../design/visual-rect';
import { usePanZoom } from '../export/use-pan-zoom';
import { PanZoomResetHint, stageOutline } from '../export/pan-zoom-stage';
import { useEffectEvent } from '../../../primitives/use-effect-event';

/** The rest view's margin between the land and the stage's tighter pair of edges, in css px. */
const PICTURE_MARGIN = 20;

const stage: CSSProperties = {
  position: 'relative', flex: 1, minWidth: 0, height: '100%', overflow: 'hidden',
  borderRadius: radii.lg, background: SEA,
};
const canvasStyle: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' };
/** The label's inset from the stage's top-left corner, in css px. */
const LABEL_INSET_X = 14;
const LABEL_INSET_Y = 12;
/** The corner wash: the label's inset plus room for its two lines and the fade, in css px. */
const VIGNETTE_SIZE = { width: 280, height: 110 } as const;
const vignetteStyle: CSSProperties = {
  position: 'absolute', left: 0, top: 0, ...VIGNETTE_SIZE, background: CORNER_VIGNETTE, pointerEvents: 'none',
};
const labelStyle: CSSProperties = {
  position: 'absolute', left: LABEL_INSET_X, top: LABEL_INSET_Y, right: 14, display: 'flex', flexDirection: 'column', gap: 2,
  pointerEvents: 'none', ...MAP_LABEL,
};
/** The toolbar's inset from the stage's top-right corner, in css px. */
const TOOLBAR_EDGE = 12;
/** Space between the label and the toolbar, in css px. */
const LABEL_GAP = 12;
const toolbarSlot: CSSProperties = { position: 'absolute', top: TOOLBAR_EDGE, right: TOOLBAR_EDGE };
const loaderStyle: CSSProperties = { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' };
const line: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

export interface PlanetPreviewProps {
  template: MapTemplate;
  /** The map to draw on it; absent draws the planet as a fresh map opens on it. */
  state?: GridState;
  dropped?: readonly MacroCoord[];
  /** The box the rest view fits, in cells; absent fits this picture's own land and dropped cells. */
  fit?: CellExtent;
  /** The planet's name over its top-left corner; absent leaves the planet the whole stage. */
  label?: string;
  /** The planet's size, the second line under its name. */
  size?: string;
  toolbar?: ReactNode;
  /** A press that ends where it began; a press that pans is not a tap. */
  onTap?: () => void;
  /** The picture is not ready: the stage holds the loader and no planet. */
  pending?: boolean;
  /** Drawn over the picture, under the outline. */
  children?: ReactNode;
}

export function PlanetPreview({ template, state, dropped, fit, label, size, toolbar, onTap, pending = false, children }: PlanetPreviewProps) {
  const pz = usePanZoom(onTap ? { onTap } : {});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // The label keeps clear of the toolbar beside it, however many tools it holds.
  const [toolbarWidth, setToolbarWidth] = useState(0);
  const { tx, ty, scale } = pz.view;
  const revision = useGridRevision(state);

  const paint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The stage's pan is in screen pixels; the painter pans in the canvas's own css pixels.
    const k = canvas.clientWidth > 0 ? visualRect(canvas).width / canvas.clientWidth || 1 : 1;
    paintPlanet(canvas, { template, state, revision, dropped }, { tx: tx / k, ty: ty / k, scale }, { margin: PICTURE_MARGIN, ...(fit ? { bounds: fit } : {}) });
  };
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const paintNow = useEffectEvent(paint);
  useLayoutEffect(() => { if (!pending) paintNow(); }, [template, state, revision, dropped, fit, tx, ty, scale, label, pending]);

  // The canvas takes its backing size from its box, so a resized stage repaints. The toolbar is
  // measured before the first paint, so the label never shows over it.
  useObservedSize(() => [canvasRef.current, toolbarRef.current], () => {
    if (!pendingRef.current) paintRef.current();
    setToolbarWidth(toolbarRef.current?.offsetWidth ?? 0);
  }, []);

  const { stageProps } = pz;
  return (
    <div data-testid="planet-preview" aria-busy={pending || undefined}
      {...stageProps}
      style={{ ...stage, ...stageProps.style }}
   >
      <canvas ref={canvasRef} aria-hidden style={pending ? { ...canvasStyle, visibility: 'hidden' } : canvasStyle} />
      {pending && <div style={loaderStyle}><Spinner /></div>}
      {label !== undefined && <div data-testid="planet-preview-vignette" style={vignetteStyle} aria-hidden />}
      {label !== undefined && (
        <div style={{ ...labelStyle, right: TOOLBAR_EDGE + (toolbarWidth ? toolbarWidth + LABEL_GAP : 0) }}>
          <span data-testid="planet-preview-name" style={{ ...roleFont('lead'), ...line }}>{label}</span>
          {size !== undefined && <span style={{ ...roleFont('small'), ...line }}>{size}</span>}
        </div>
      )}
      {children}
      {/* A press on a tool is the tool's: the stage captures the pointer on press, which would take
          the click away from the button. */}
      <div ref={toolbarRef} style={toolbarSlot} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>{toolbar}</div>
      <PanZoomResetHint show={pz.showResetHint} />
      <div style={stageOutline} aria-hidden />
    </div>
  );
}
