/**
 * Keeps the selection card where `selection-card-layout.ts` places it: reads the selection through
 * the active view's projection on every viewport, object, cell, resize, chrome-scale and active-view
 * change, writes the box imperatively, and glides it on a relocation of its own. A wheel the card
 * does not use itself keeps driving the map.
 */
import { useCallback, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { viewportSize } from '../../../platform/device/viewport-space';
import type { GridState, PlacedObject, Rotation } from '../../../core/model/types';
import { DIR_OFFSETS, ROTATION_FACING } from '../../../core/grid/directions';
import { type BlockRef, groupBounds, groupMembers, selectedObjectIds, singleSelection } from '../../../state/selection';
import { getActiveView, onProjectionChange } from '../../../view/active-view';
import { forwardMapWheel } from '../../../view/interaction/map-wheel';
import type { ViewProjection } from '../../../tools/pointer/runtime';
import { useEditorStore } from '../../../state/store';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { GROUP_ROTATION_CAUSE } from '../../../editor/editing/group-edit';
import { terrainCellRect } from '../../../core/grid/grid-convert';
import { cellKey, rectsBounds } from '../../../core/grid/rect';
import { isWebKitEngine } from '../../design/shape-edge';
import { easingCss, seconds } from '../../design/motion';
import { visualRect } from '../../design/visual-rect';
import { clearMapArea } from '../../primitives/map-edge';
import { useObservedSize } from '../../primitives/use-observed-size';
import {
  cardBoxStyle, holdPlace, placeFittedCard, tailStyle, type Area, type HeldPlace, type ScreenBounds, type ViewportSize,
} from './selection-card-layout';
import { selectedGroup } from '../../../state/placed-groups';
import { groupScreenBox, projectedBox } from './projected-box';
import { screenAngleOf } from './map-direction';

/** Screen bounds of what is selected, in visual px, or null when it cannot be placed. */
function selectionBounds(sel: readonly BlockRef[], gs: GridState, proj: ViewProjection): ScreenBounds | null {
  const footprint = (x: number, y: number, w: number, h: number) => projectedBox(proj, { x, y, w, h });
  const group = selectedGroup({ gridState: gs, selection: sel, editMode: useEditorStore.getState().editMode });
  if (group) {
    return groupScreenBox(proj, gs, group);
  }
  if (sel.length > 1) {
    const members = groupMembers(gs, selectedObjectIds(sel));
    if (members.length === 0) return null;
    if (proj.objectScreenBox) {
      return rectsBounds(members.map((m) => proj.objectScreenBox!(m.id)).filter((b): b is ScreenBounds => !!b));
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

/** Screen angle, clockwise from up, of a facing's front through the active projection. */
export function facingAngle(facing: Rotation, obj: PlacedObject | null, proj: ViewProjection | undefined): number {
  const { dx, dy } = DIR_OFFSETS[ROTATION_FACING[facing]];
  const size = obj && getPlacedObjectSize(obj);
  const centre = obj && size ? { x: obj.position.x + size.w / 2, y: obj.position.y + size.h / 2 } : null;
  return screenAngleOf(dx, dy, centre, proj);
}

/** The longest the header's name may run, and the least it shortens to for a narrow map area, in css px. */
export const TITLE_MAX = 220;
export const TITLE_MIN = 48;

/** Where a card reads what it is placed against: the selection and its map, the projection, the room
 *  it stands in and when to place it again. The live card reads the store, the active view and the
 *  window; a Help figure hands in its own world's, whose projection answers in its box's px. */
export interface CardPlaceSource {
  read: () => { selection: readonly BlockRef[]; gridState: GridState | null };
  projection: () => ViewProjection | null | undefined;
  /** The box the card's coordinates are measured in, and the part of it the map stands clear in. */
  frame: () => { viewport: ViewportSize; areaAt: (rows?: { top: number; bottom: number }) => Area };
  /** Calls `tell` whenever the card may have to be placed again, with a map edit's cause; returns the unsubscribe. */
  watch: (tell: (cause?: string) => void) => () => void;
  /** Whether a wheel over the card drives the map (only the live map takes one). */
  wheel: boolean;
}

/** The live card's source: the store, the active view and the window. */
const LIVE_PLACE: CardPlaceSource = {
  read: () => useEditorStore.getState(),
  projection: () => getActiveView()?.projection,
  frame: () => {
    const vp = viewportSize();
    return { viewport: vp, areaAt: (rows) => clearMapArea(vp, rows) };
  },
  watch: (tell) => onProjectionChange(useEditorStore.getState().eventBus, tell, { objects: true }),
  wheel: true,
};

/** The card's parts the placement writes to, by ref. */
interface CardRefs {
  box: RefObject<HTMLDivElement>;
  header: RefObject<HTMLDivElement>;
  /** The details' body, laid out at its opened height however far it is folded. */
  body: MutableRefObject<HTMLElement | null>;
  tail: RefObject<HTMLSpanElement>;
  scroll: RefObject<HTMLDivElement>;
}

/** Places the card for `selection`, its header `row` css px tall with a pointer of side `tail`,
 *  drawn at `zoom`: the refs to attach to its parts, whether its details grow upward from the
 *  header, and whether the header's name has been cut short for this card. */
export function useSelectionCardPlace(
  zoom: number, locale: string, { row, tail }: { row: number; tail: number }, selection: readonly BlockRef[],
  source: CardPlaceSource = LIVE_PLACE,
): { refs: CardRefs; growUp: boolean; nameCut: boolean } {
  const box = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLElement | null>(null);
  const pointer = useRef<HTMLSpanElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const refs = useRef<CardRefs>({ box, header, body, tail: pointer, scroll }).current;
  const [growUp, setGrowUp] = useState(true);
  const [nameCut, setNameCut] = useState(false);
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
    const proj = source.projection();
    const state = source.read();
    const gsLive = state.gridState;
    if (!box || !header || !proj || !gsLive) return;
    // Mid group rotation the members are briefly off the map; the card keeps its place and adopts
    // the members' new positions once the operation has finished.
    if (cause === GROUP_ROTATION_CAUSE) { adoptPositions.current = true; return; }
    const sel = state.selection;
    const z = zoomRef.current;
    const { viewport: vp, areaAt } = source.frame();
    const positions = memberPositions(sel, gsLive);
    // A move or a turn removes a member before placing it back; wait for it to land.
    if (hold.current && positions.includes('-')) return;
    const drawn = box.style.visibility !== 'hidden' ? visualRect(header) : null;
    // The header is read with its name at its natural width, so the fit below never feeds on itself.
    const title = header.querySelector<HTMLElement>('[data-card-title]');
    box.style.setProperty('--title-max', `${TITLE_MAX}px`);
    const parts = { title: (title?.offsetWidth ?? 0) * z, others: (header.offsetWidth - (title?.offsetWidth ?? 0)) * z };
    const natural = { w: header.offsetWidth * z, h: header.offsetHeight * z, body: (refs.body.current?.offsetHeight ?? 0) * z };
    const next = {
      members: sel.map((b) => (b.kind === 'object' ? b.id : cellKey(b.x, b.y))).join(','),
      positions,
      rotations: memberRotations(sel, gsLive),
      camera: cameraSignature(proj),
      frame: `${z}|${vp.width}x${vp.height}|${Math.round(natural.w)}x${Math.round(natural.h)}`,
    };
    const decision = holdPlace(hold.current, next, adoptPositions.current);
    adoptPositions.current = false;
    const bounds = decision.keep ? hold.current!.bounds : selectionBounds(sel, gsLive, proj);
    if (!bounds) { box.style.visibility = 'hidden'; hold.current = null; return; }
    // A relocation of the card's own (a moved member, a new side, a new size) travels; following
    // the camera does not, or the card would trail the map it rides on.
    const travel = decision.travel && !reducedRef.current && box.style.visibility !== 'hidden';
    const from = travel ? drawn : null;
    if (!travel) { moveAnim.current?.cancel(); moveAnim.current = null; }
    // The right-hand column narrows the map only level with its own controls, here the header's row;
    // opened details may pass a column's label further up. The name shortens to fit that width.
    const fit = placeFittedCard(bounds, parts, natural, vp,
      { areaAt, prefer: decision.prefer, titleMin: TITLE_MIN * z, titleMax: TITLE_MAX * z });
    const { placement: p, area, size } = fit;
    if (title) {
      box.style.setProperty('--title-max', `${fit.titleCap / z}px`);
      // A name cut short says itself in full on hover; a touch name wraps instead (`SelectionCard.tsx`).
      const cut = title.scrollWidth > title.clientWidth + 1 || title.scrollHeight > title.clientHeight + 1;
      if (cut) title.title = title.textContent ?? ''; else title.removeAttribute('title');
      // Once cut, the name stays cut for this card: a details line it adds can move the card, and
      // a fit that let go again could move it back.
      if (cut) setNameCut(true);
    }
    hold.current = { ...next, bounds, side: p.visible ? p.side : undefined };
    if (!p.visible) { box.style.visibility = 'hidden'; return; }
    box.style.visibility = '';
    box.dataset.grow = p.growUp ? 'up' : 'down';
    const at = cardBoxStyle(p, size, vp, area, { zoom: z, minRoom: row * 2 });
    // Where nothing holds the whole opened card, the details scroll inside the room there is.
    box.style.setProperty('--details-max', `${at.detailsMax}px`);
    const obj = sel.length === 1 && sel[0]!.kind === 'object' ? gsLive.objects.get(sel[0]!.id) ?? null : null;
    for (const arrow of box.querySelectorAll<SVGElement>('[data-facing]')) {
      arrow.style.transform = `rotate(${facingAngle(Number(arrow.dataset.facing) as Rotation, obj, proj)}deg)`;
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
  }, [refs, row, tail, source]);

  useLayoutEffect(() => {
    place();
    const offProjection = source.watch(place);
    const box = source.wheel ? refs.box.current : null;
    const onWheel = (e: WheelEvent) => {
      const scroller = refs.scroll.current;
      // Details that scroll keep a vertical wheel, at either end too, so a scroll run past the end
      // never turns into a zoom of the map; a pinch, a sideways wheel or details that fit go on to it.
      if (scroller && e.target instanceof Node && scroller.contains(e.target) && !e.ctrlKey
        && Math.abs(e.deltaY) > Math.abs(e.deltaX) && scroller.scrollHeight > scroller.clientHeight + 1) return;
      forwardMapWheel(e);
    };
    box?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      offProjection();
      box?.removeEventListener('wheel', onWheel);
    };
  }, [place, refs, source]);
  // The header row's own size, and the details' (a line they gain), move where it fits.
  useObservedSize(() => [refs.header.current, refs.body.current], () => place(), [place], { immediate: false });
  // A chrome-scale change rescales the `zoom` subtree without emitting anything.
  useLayoutEffect(() => { place(); }, [zoom, locale, place]);
  // A placed blueprint moved or turned whole is laid again under new ids and selected once it has
  // landed, under the same card; every edit event before that found a member off the map and
  // waited, so the new selection is what places it.
  useLayoutEffect(() => { place(); }, [selection, place]);
  return { refs, growUp, nameCut };
}
