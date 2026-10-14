/**
 * Keeps the selection card where `selection-card-layout.ts` places it: reads the selection through
 * the active view's projection on every viewport, object, cell, resize, chrome-scale and active-view
 * change, writes the box imperatively, and glides it on a relocation of its own. A wheel the card
 * does not use itself keeps driving the map.
 */
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { viewportSize } from '../../../platform/device/viewport-space';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { type BlockRef, groupBounds, groupMembers, selectedObjectIds, singleSelection } from '../../../state/selection';
import { getActiveView, onProjectionChange } from '../../../view/active-view';
import { forwardMapWheel } from '../../../view/interaction/map-wheel';
import type { ViewProjection } from '../../../tools/pointer/runtime';
import { useEditorStore } from '../../../state/store';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { GROUP_ROTATION_CAUSE } from '../../../editor/editing/group-edit';
import { terrainCellRect } from '../../../core/grid/grid-convert';
import { cellKey } from '../../../core/grid/rect';
import { isWebKitEngine } from '../../design/shape-edge';
import { easingCss, seconds } from '../../design/motion';
import { visualRect } from '../../design/visual-rect';
import { clearMapArea } from '../../primitives/map-edge';
import { useObservedSize } from '../../primitives/use-observed-size';
import { cardBoxStyle, holdPlace, placeSelectionCard, tailStyle, type HeldPlace, type ScreenBounds } from './selection-card-layout';

/** Screen bounds of what is selected, in visual px, or null when it cannot be placed. */
function selectionBounds(sel: readonly BlockRef[], gs: GridState, proj: ViewProjection): ScreenBounds | null {
  const boxOf = (corners: { x: number; y: number; behind?: boolean }[]) => {
    if (corners.some((p) => p.behind)) return null;
    const x = Math.min(...corners.map((p) => p.x)), y = Math.min(...corners.map((p) => p.y));
    return { x, y, w: Math.max(...corners.map((p) => p.x)) - x, h: Math.max(...corners.map((p) => p.y)) - y };
  };
  const footprint = (x: number, y: number, w: number, h: number) => boxOf([
    proj.cellToScreen(x, y), proj.cellToScreen(x + w, y), proj.cellToScreen(x, y + h), proj.cellToScreen(x + w, y + h),
  ]);
  if (sel.length > 1) {
    const members = groupMembers(gs, selectedObjectIds(sel));
    if (members.length === 0) return null;
    if (proj.objectScreenBox) {
      const boxes = members.map((m) => proj.objectScreenBox!(m.id)).filter((b): b is ScreenBounds => !!b);
      if (boxes.length === 0) return null;
      const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
      return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
    }
    const b = groupBounds(members);
    return footprint(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  }
  const block = singleSelection(sel);
  if (block?.kind === 'object') {
    const obj = gs.objects.get(block.id);
    if (!obj) return null;
    if (proj.objectScreenBox) return proj.objectScreenBox(block.id);
    const size = getPlacedObjectSize(obj);
    return footprint(obj.position.x, obj.position.y, size.w, size.h);
  }
  if (block?.kind === 'terrain') { const r = terrainCellRect(block); return footprint(r.x, r.y, r.w, r.h); }
  return null;
}

/** Changes whenever the camera does, and only then. */
function cameraSignature(proj: ViewProjection): string {
  return [[0, 0], [8, 0], [0, 8]].map(([x, y]) => {
    const p = proj.cellToScreen(x!, y!);
    return `${Math.round(p.x * 2)},${Math.round(p.y * 2)}${p.behind ? 'b' : ''}`;
  }).join(';');
}

function memberPositions(sel: readonly BlockRef[], gs: GridState): string {
  return sel.map((b) => {
    if (b.kind !== 'object') return cellKey(b.x, b.y);
    const o = gs.objects.get(b.id);
    return o ? cellKey(o.position.x, o.position.y) : '-';
  }).join(';');
}

/** A turn can shift a footprint's anchor cell; a change of facing marks that shift as the member's own. */
function memberRotations(sel: readonly BlockRef[], gs: GridState): string {
  return sel.map((b) => (b.kind === 'object' ? gs.objects.get(b.id)?.rotation ?? '-' : '')).join(';');
}

/** Map direction of an item's front for each facing: south at 0 degrees, turning clockwise. */
const FRONT: Record<string, [number, number]> = { '0': [0, 1], '90': [-1, 0], '180': [0, -1], '270': [1, 0] };

/** Screen angle, clockwise from up, of a facing's front through the active projection. */
export function facingAngle(facing: string, obj: PlacedObject | null, proj: ViewProjection | undefined): number {
  const [dx, dy] = FRONT[facing] ?? [0, 1];
  if (!obj || !proj) return Math.atan2(dx, -dy) * 180 / Math.PI;
  const size = getPlacedObjectSize(obj);
  const cx = obj.position.x + size.w / 2, cy = obj.position.y + size.h / 2;
  const a = proj.cellToScreen(cx, cy), b = proj.cellToScreen(cx + dx, cy + dy);
  return Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI;
}

/** The card's parts the placement writes to, by ref. */
export interface CardRefs {
  box: RefObject<HTMLDivElement>;
  header: RefObject<HTMLDivElement>;
  body: RefObject<HTMLDivElement>;
  tail: RefObject<HTMLSpanElement>;
  scroll: RefObject<HTMLDivElement>;
}

/** Places the card for a header `row` css px tall with a pointer of side `tail`, drawn at `zoom`:
 *  the refs to attach to its parts, and whether its details grow upward from the header. */
export function useSelectionCardPlace(zoom: number, locale: string, row: number, tail: number): { refs: CardRefs; growUp: boolean } {
  const box = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const pointer = useRef<HTMLSpanElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const refs = useRef<CardRefs>({ box, header, body, tail: pointer, scroll }).current;
  const [growUp, setGrowUp] = useState(true);
  const reduced = useReducedMotionConfig() === true;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const moveAnim = useRef<Animation | null>(null);
  const hold = useRef<HeldPlace | null>(null);
  const adoptPositions = useRef(false);

  const place = useCallback((cause?: string) => {
    const box = refs.box.current, header = refs.header.current;
    const proj = getActiveView()?.projection;
    const state = useEditorStore.getState();
    const gsLive = state.gridState;
    if (!box || !header || !proj || !gsLive) return;
    // Mid group rotation the members are briefly off the map; the card keeps its place and adopts
    // the members' new positions once the operation has finished.
    if (cause === GROUP_ROTATION_CAUSE) { adoptPositions.current = true; return; }
    const sel = state.selection;
    const z = zoomRef.current;
    const vp = viewportSize();
    const size = { w: header.offsetWidth * z, h: header.offsetHeight * z, body: (refs.body.current?.offsetHeight ?? 0) * z };
    const positions = memberPositions(sel, gsLive);
    // A move or a turn removes a member before placing it back; wait for it to land.
    if (hold.current && positions.includes('-')) return;
    const next = {
      members: sel.map((b) => (b.kind === 'object' ? b.id : cellKey(b.x, b.y))).join(','),
      positions,
      rotations: memberRotations(sel, gsLive),
      camera: cameraSignature(proj),
      frame: `${z}|${vp.width}x${vp.height}|${Math.round(size.w)}x${Math.round(size.h)}`,
    };
    const decision = holdPlace(hold.current, next, adoptPositions.current);
    adoptPositions.current = false;
    const bounds = decision.keep ? hold.current!.bounds : selectionBounds(sel, gsLive, proj);
    if (!bounds) { box.style.visibility = 'hidden'; hold.current = null; return; }
    // A relocation of the card's own (a moved member, a new side, a new size) travels; following
    // the camera does not, or the card would trail the map it rides on.
    const travel = decision.travel && !reducedRef.current && box.style.visibility === 'visible';
    const from = travel ? visualRect(header) : null;
    if (!travel) { moveAnim.current?.cancel(); moveAnim.current = null; }
    const area = clearMapArea(vp);
    const p = placeSelectionCard(bounds, size, vp, { area, prefer: decision.prefer });
    hold.current = { ...next, bounds, side: p.visible ? p.side : undefined };
    if (!p.visible) { box.style.visibility = 'hidden'; return; }
    box.style.visibility = 'visible';
    box.dataset.grow = p.growUp ? 'up' : 'down';
    const at = cardBoxStyle(p, size, vp, area, { zoom: z, minRoom: row * 2 });
    // Where nothing holds the whole opened card, the details scroll inside the room there is.
    box.style.setProperty('--details-max', `${at.detailsMax}px`);
    const obj = sel.length === 1 && sel[0]!.kind === 'object' ? gsLive.objects.get(sel[0]!.id) ?? null : null;
    for (const arrow of box.querySelectorAll<SVGElement>('[data-facing]')) {
      arrow.style.transform = `rotate(${facingAngle(arrow.dataset.facing!, obj, proj)}deg)`;
    }
    box.style.left = `${at.left}px`;
    box.style.top = at.top === null ? 'auto' : `${at.top}px`;
    box.style.bottom = at.bottom === null ? 'auto' : `${at.bottom}px`;
    setGrowUp(p.growUp);
    // Applied now as well as on render, so the travel below measures the header where it will stand.
    const card = box.firstElementChild as HTMLElement | null;
    card?.style.setProperty('flex-direction', p.growUp ? 'column-reverse' : 'column');
    if (refs.tail.current) {
      // Half of the pointer is inside the plate's silhouette, so the shared outline runs from the
      // plate down one side and back up. ShapeEdge paints WebKit at double size.
      const drawn = tailStyle(p, z, tail, row, isWebKitEngine() ? 2 : 1);
      Object.assign(refs.tail.current.style, drawn.box);
      if (card) card.style.transformOrigin = drawn.origin;
    }
    if (from) {
      // Flip from where the header row was drawn, including any travel still under way.
      moveAnim.current?.cancel();
      const to = visualRect(header);
      const dx = (from.left - to.left) / z, dy = (from.top - to.top) / z;
      if (Math.abs(dx) + Math.abs(dy) > 1 && typeof box.animate === 'function') {
        moveAnim.current = box.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: seconds('selection.card.move') * 1000, easing: easingCss('selection.card.move') },
        );
      }
    }
  }, [refs, row, tail]);

  useLayoutEffect(() => {
    const bus = useEditorStore.getState().eventBus;
    place();
    const offProjection = onProjectionChange(bus, place, { objects: true });
    const box = refs.box.current;
    const onWheel = (e: WheelEvent) => {
      const scroller = refs.scroll.current;
      if (scroller && e.target instanceof Node && scroller.contains(e.target) && !e.ctrlKey) {
        const room = e.deltaY > 0 ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop : scroller.scrollTop;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && room > 0) return;
      }
      forwardMapWheel(e);
    };
    box?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      offProjection();
      box?.removeEventListener('wheel', onWheel);
    };
  }, [place, refs]);
  // The header row's own size moves where it fits.
  useObservedSize(() => refs.header.current, () => place(), [place], { immediate: false });
  // A chrome-scale change rescales the `zoom` subtree without emitting anything.
  useLayoutEffect(() => { place(); }, [zoom, locale, place]);
  return { refs, growUp };
}
