/**
 * The selection marks of a view that projects bodies rather than footprints (the 3D view), drawn in
 * screen space over each member's projected box: corner brackets around one member, a ring per
 * member with brackets around the whole of a group. They are the 2D view's marks in the same
 * map-label treatment, and they stand over the scenery, so an occluded member still shows it is
 * selected. The hover outline around what a click would select is drawn the same way. A terrain
 * cell or a lone road is regular, so the scene draws its exact box instead, and the scene drapes the hover shadow on
 * the ground. The 2D renderer draws its own marks and hover box.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { getActiveView, onProjectionChange } from '../../../view/active-view';
import { hoverTarget, onHoverTargetChange } from '../../../view/hover-target';
import type { ViewProjection } from '../../../tools/pointer/runtime';
import { useEditorStore } from '../../../state/store';
import { type BlockRef } from '../../../state/selection';
import { getCatalogItem } from '../../../state/catalog';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { INK, MAP_EDGE_ALPHA, MAP_TEXT, ON_DARK, rgbaOf } from '../../design/tokens';
import { easingCss, seconds } from '../../design/motion';
import { z } from '../../design/styles';
import { isCoatingItem } from '../../../core/model/traits';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { HOVER_BOX, SELECTION_MARKS, bracketArm, ringRadius } from '../../../view/shared/overlay/selection-marks';
import { cellKey } from '../../../core/grid/rect';

const { stroke: STROKE, edge: EDGE, pad: PAD, groupPad: GROUP_PAD, ringStroke: RING_STROKE, ringEdge: RING_EDGE, ringLimit: RING_LIMIT } = SELECTION_MARKS;

interface Box { x: number; y: number; w: number; h: number }

function memberBox(ref: BlockRef, proj: ViewProjection): Box | null {
  return ref.kind === 'object' ? proj.objectScreenBox?.(ref.id) ?? null : null;
}

/** A road is flat and regular: the scene drapes its exact box, so the screen marks leave it alone. */
function isRoad(id: string): boolean {
  const obj = useEditorStore.getState().gridState?.objects.get(id);
  return !!obj && isCoatingItem(getCatalogItem(obj.catalogId));
}

function bracketPath(r: Box, pad: number): string {
  const x = r.x - pad, y = r.y - pad, w = r.w + 2 * pad, h = r.h + 2 * pad;
  const arm = bracketArm(w, h);
  return `M${x} ${y + arm}V${y}H${x + arm}M${x + w - arm} ${y}H${x + w}V${y + arm}`
    + `M${x + w} ${y + h - arm}V${y + h}H${x + w - arm}M${x + arm} ${y + h}H${x}V${y + h - arm}`;
}

function ringPath(r: Box): string {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = ringRadius(r.w, r.h);
  return `M${cx - rad} ${cy}a${rad} ${rad} 0 1 0 ${rad * 2} 0a${rad} ${rad} 0 1 0 ${-rad * 2} 0`;
}

const HOVER_FILL = rgbaOf(ON_DARK, HOVER_BOX.fillAlpha);
const alphaHex = (alpha: number) => Math.round(alpha * 255).toString(16).padStart(2, '0');
const hoverInk = `${INK}${alphaHex(HOVER_BOX.edgeAlpha)}`;

/** The screen box of what is hovered: an object's projected body, or a terrain cell. */
function hoverBox(proj: ViewProjection): Box | null {
  const target = hoverTarget();
  if (!target || target.grid !== PLACEMENT_GRID) return null;
  const gs = useEditorStore.getState().gridState;
  for (const obj of gs?.objects.values() ?? []) {
    if (obj.position.x !== target.x || obj.position.y !== target.y) continue;
    const size = getPlacedObjectSize(obj);
    if (size.w === target.w && size.h === target.h) return isRoad(obj.id) ? null : proj.objectScreenBox?.(obj.id) ?? null;
  }
  return null;
}

const edgeInk = `${INK}${alphaHex(MAP_EDGE_ALPHA)}`;

export function SelectionMarks() {
  const svgRef = useRef<SVGSVGElement>(null);
  const selection = useEditorStore((s) => s.selection);
  const reduced = useReducedMotionConfig() === true;
  const lastKey = useRef('');

  const draw = useRef(() => {});
  draw.current = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const proj = getActiveView()?.projection;
    const sel = useEditorStore.getState().selection;
    if (!proj?.objectScreenBox) { svg.innerHTML = ''; lastKey.current = ''; return; }
    const hover = hoverBox(proj);
    const hoverSvg = hover ? `<rect x="${hover.x}" y="${hover.y}" width="${hover.w}" height="${hover.h}" rx="${HOVER_BOX.radius}" fill="${HOVER_FILL}" stroke="${hoverInk}" stroke-width="${HOVER_BOX.stroke}"/>` : '';
    const lone = sel.length === 1 && sel[0]!.kind === 'object' && isRoad(sel[0]!.id);
    const boxes = (lone ? [] : sel).map((ref) => memberBox(ref, proj)).filter((b): b is Box => !!b && b.w >= 0 && b.h >= 0);
    if (boxes.length === 0) { svg.innerHTML = hoverSvg; lastKey.current = ''; return; }
    let d: string;
    let rings = '';
    if (boxes.length === 1) d = bracketPath(boxes[0]!, PAD);
    else {
      const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
      d = bracketPath({ x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }, GROUP_PAD);
      if (boxes.length <= RING_LIMIT) rings = boxes.map(ringPath).join('');
    }
    const layer = (path: string, width: number, stroke: string) =>
      path ? `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>` : '';
    svg.innerHTML = `${hoverSvg}<g>${layer(rings, RING_EDGE, edgeInk)}${layer(rings, RING_STROKE, MAP_TEXT)}${layer(d, EDGE, edgeInk)}${layer(d, STROKE, MAP_TEXT)}</g>`;
    // A new selection lands with the same beat the 2D marks pop with; a re-track does not.
    const key = sel.map((b) => (b.kind === 'object' ? b.id : cellKey(b.x, b.y))).join(',');
    if (key !== lastKey.current && !reduced) {
      const g = svg.querySelector('g') as SVGGElement;
      g.style.transformBox = 'fill-box';
      g.style.transformOrigin = 'center';
      g.animate?.([{ transform: 'scale(1.12)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: seconds('selection.fade') * 1000, easing: easingCss('selection.fade') });
    }
    lastKey.current = key;
  };

  useLayoutEffect(() => { draw.current(); }, [selection]);

  useEffect(() => {
    const bus = useEditorStore.getState().eventBus;
    const onEvent = () => draw.current();
    const offProjection = onProjectionChange(bus, onEvent, { objects: true });
    const offHover = onHoverTargetChange(onEvent);
    return () => {
      offHover();
      offProjection();
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      aria-hidden
      data-testid="selection-marks"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: z.canvasControls }}
    />
  );
}

