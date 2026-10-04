/**
 * The card a map selection wears: the item's name and its actions on one row, with its details grown
 * from that row on request. Tracks the selection through the ACTIVE view's projection, imperatively,
 * on viewport, object, cell, resize, chrome-scale and active-view changes (`viewMode` flips before the
 * replacement projection registers).
 *
 * The row is placed where the opened card also fits, and then holds still through the selection's
 * own edits (a rotation, a new facing, opening the details): only a camera change, a member moving,
 * a membership change or a new size re-reads its place. A group rotation removes every member before
 * placing any back, so the card keeps its place for the whole operation. While the camera moves the
 * card follows and keeps its side of the selection.
 */
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { viewportSize } from '../../../core/runtime/viewport-space';
import { getCell } from '../../../core/model/grid-model';
import { turnsInSession } from '../../../kit/operations/planet-session';
import { surfaceElevation } from '../../../core/edge-cut/terrain-silhouette';
import { TerrainType, type BlockRef, type GridState, type PlacedObject, type Rotation, turnRotation } from '../../../core/model/types';
import { getActiveView, onProjectionChange } from '../../../canvas/active-view';
import { forwardMapWheel } from '../../../canvas/interaction/map-wheel';
import type { ViewProjection } from '../../../canvas/view-projection';
import { useEditorStore } from '../../../state/store';
import { singleSelection, selectedObjectIds } from '../../../state/selection';
import { getCatalogItem } from '../../../state/catalog';
import { subscribeMapStats } from '../../../state/map-stats';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { groupMembers, groupBounds } from '../../../tools/objects';
import { formatLoad } from '../../../i18n/load';
import { useT, localizedName } from '../../../i18n/context';
import { iconUrl } from '../../../assets/icon-urls';
import { pickedMaterial, pickSelection } from '../../../kit/pick-selection';
import { rotateGroupAction, rotateObjectAction, rotateSessionPlazaAction, deleteSelection, isGroupRotationInFlight } from '../../../kit/group-edit';
import { touchFloorZoom, useChromeScale, useDenseScript, useDevicePixelRatio, useTouchPrimary } from '../../design/scale';
import { colors, cursors, exitTransition, font, interactionProfiles, radii, springs, z } from '../../design/styles';
import { INK, INSET, LINE, PLATE, PLATE_INK } from '../../design/tokens';
import { ShapeEdge, isWebKitEngine } from '../../design/shape-edge';
import { skin } from '../../design/window-skin';
import { roleFont, weightVars } from '../../design/text-weight';
import { amplitude, easingCss, framerMotion, seconds } from '../../design/motion';
import { visualRect } from '../../design/visual-rect';
import { SegmentedControl } from '../../primitives/SegmentedControl';
import { Glyph, TrashIcon } from '../../primitives/line-glyphs';
import { MODES } from '../../shell/frame';
import { layerName } from '../../shell/layer-name';
import { helpTargetAttr } from '../modals/help/targets';
import { clearMapArea } from '../../primitives/map-edge';
import { CARD_MARGIN, placeSelectionCard, type CardSide, type ScreenBounds } from './selection-card-layout';

/** Header row height in css px; its ends are half-circles. */
const ROW = 48;
const BUTTON = 40;
const THUMB = 36;
/** Side of the rotated square whose outer half is the pointer, in css px. */
const TAIL = 14;
const FACINGS = ['0', '90', '180', '270'] as const;
type Facing = typeof FACINGS[number];

/** The action a selection can take; locked objects (the plaza) and bare ground take none. */
interface Target {
  key: string;
  plural: boolean;
  block: BlockRef | null;
  object: PlacedObject | null;
  rotatable: boolean;
  deletable: boolean;
  pickable: boolean;
  /** The planet session's plaza: it turns about its centre with its footprint swapped, so it has no facing. */
  sessionPlaza: boolean;
}

function readTarget(selection: readonly BlockRef[], gs: GridState | null, inSession: boolean): Target | null {
  const plural = selection.length > 1;
  if (plural) {
    return { key: `g:${selectedObjectIds(selection).join(',')}`, plural, block: null, object: null, rotatable: true, deletable: true, pickable: false, sessionPlaza: false };
  }
  const block = singleSelection(selection);
  if (!block || !gs) return null;
  const object = block.kind === 'object' ? gs.objects.get(block.id) ?? null : null;
  const item = object ? getCatalogItem(object.catalogId) : null;
  const terrain = block.kind === 'terrain' ? getCell(gs.cells, block.x, block.y)?.terrain ?? null : null;
  const sessionPlaza = turnsInSession(object, inSession);
  const rotatable = (!!item?.rotatable && !object?.locked) || sessionPlaza;
  const deletable = (!!object && !object.locked) || !!terrain;
  const pickable = pickedMaterial(gs, selection) !== null;
  if (!deletable && !pickable) return null;
  return { key: block.kind === 'object' ? block.id : `t:${block.x},${block.y}`, plural, block, object, rotatable, deletable, pickable, sessionPlaza };
}

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
  // Terrain's rendered footprint is shifted half a macro cell up-left.
  if (block?.kind === 'terrain') return footprint(block.x - 0.5, block.y - 0.5, 1, 1);
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
    if (b.kind !== 'object') return `${b.x},${b.y}`;
    const o = gs.objects.get(b.id);
    return o ? `${o.position.x},${o.position.y}` : '-';
  }).join(';');
}

/** A turn can shift a footprint's anchor cell; a change of facing marks that shift as the member's own. */
function memberRotations(sel: readonly BlockRef[], gs: GridState): string {
  return sel.map((b) => (b.kind === 'object' ? gs.objects.get(b.id)?.rotation ?? '-' : '')).join(';');
}

const btnReset: CSSProperties = { border: 'none', padding: 0, margin: 0, background: 'transparent', fontFamily: font.family, cursor: cursors.clickable, WebkitTapHighlightColor: 'transparent' };

const iconButton: CSSProperties = {
  ...btnReset, width: BUTTON, height: BUTTON, flex: 'none', borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK,
};

/** A block with a quarter-turn arrow over it: this item turns 90 degrees clockwise. */
const RotateIcon = () => (
  <Glyph>
    <rect x="3.5" y="11" width="9" height="9" rx="2" />
    <path d="M7.5 6.6A9.5 9.5 0 0 1 19.4 15" />
    <path d="M16.4 13.2l3 2.3 2.2-3" />
  </Glyph>
);
const PickIcon = () => <Glyph><path d="m14 6 2.5-2.5a3 3 0 0 1 4 4L18 10" /><path d="m12 5 7 7M14 7l-9 9-1 4 4-1 9-9" /></Glyph>;
/** An arrow pointing where the item's front looks on screen for one facing (`data-facing`); the card
 *  turns it with the camera. */
const FacingArrow = ({ facing, deg }: { facing: string; deg: number }) => (
  <svg data-facing={facing} width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', transform: `rotate(${deg}deg)` }}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

/** Map direction of an item's front for each facing: south at 0 degrees, turning clockwise. */
const FRONT: Record<string, [number, number]> = { '0': [0, 1], '90': [-1, 0], '180': [0, -1], '270': [1, 0] };

/** Screen angle, clockwise from up, of a facing's front through the active projection. */
function facingAngle(facing: string, obj: PlacedObject | null, proj: ViewProjection | undefined): number {
  const [dx, dy] = FRONT[facing] ?? [0, 1];
  if (!obj || !proj) return Math.atan2(dx, -dy) * 180 / Math.PI;
  const size = getPlacedObjectSize(obj);
  const cx = obj.position.x + size.w / 2, cy = obj.position.y + size.h / 2;
  const a = proj.cellToScreen(cx, cy), b = proj.cellToScreen(cx + dx, cy + dy);
  return Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI;
}

function Thumb({ src, color, count }: { src?: string; color?: string; count?: number }) {
  return (
    <span style={{ position: 'relative', width: THUMB, height: THUMB, flex: 'none', borderRadius: '50%', background: INSET, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {src ? <img src={src} alt="" draggable={false} style={{ width: '80%', height: '80%', objectFit: 'contain', pointerEvents: 'none' }} />
        : color ? <span style={{ width: '56%', height: '56%', borderRadius: radii.sm, background: color }} /> : null}
      {count !== undefined && (
        <span style={{ position: 'absolute', right: -3, bottom: -3, minWidth: 18, height: 18, padding: '0 4px', borderRadius: radii.pill, background: INK, color: PLATE, ...roleFont('small'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{count}</span>
      )}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: INSET, borderRadius: radii.md, padding: '8px 12px', minWidth: 0 }}>
      <div style={{ ...roleFont('head'), color: PLATE_INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      <div style={{ ...roleFont('note'), color: skin.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
    </div>
  );
}

export function SelectionCard() {
  const t = useT();
  const selection = useEditorStore((s) => s.selection);
  const gridState = useEditorStore((s) => s.gridState);
  const eventBus = useEditorStore((s) => s.eventBus);
  const locale = useEditorStore((s) => s.locale);
  const [, repaint] = useReducer((n: number) => n + 1, 0);
  useEffect(() => selection.length > 0
    ? subscribeMapStats(eventBus, () => useEditorStore.getState().gridState, repaint)
    : undefined, [eventBus, selection.length]);
  const inSession = useEditorStore((s) => !!s.planetSession);
  const target = readTarget(selection, gridState, inSession);
  const chrome = useChromeScale();
  const touch = useTouchPrimary();
  const zoom = touchFloorZoom(chrome, touch, BUTTON);
  // Weights resolve for the size the card is drawn at, which the touch floor can raise above the chrome's.
  const weights = weightVars(zoom, useDevicePixelRatio(), useDenseScript());

  return (
    <AnimatePresence>
      {target && gridState && (
        <CardBody key={target.key} target={target} gs={gridState} zoom={zoom} weights={weights} t={t} locale={locale} />
      )}
    </AnimatePresence>
  );
}

function CardBody({ target, gs, zoom, weights, t, locale }: {
  target: Target;
  gs: GridState;
  zoom: number;
  weights: CSSProperties;
  t: ReturnType<typeof useT>;
  locale: ReturnType<typeof useEditorStore.getState>['locale'];
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLSpanElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [growUp, setGrowUp] = useState(true);
  // The unfold animates to the body's LAYOUT height. A height of 'auto' is measured on screen, so under
  // a chrome zoom below 1 it stops short and then snaps to the real height.
  const [bodyHeight, setBodyHeight] = useState(0);
  const reduced = useReducedMotionConfig() === true;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const moveAnim = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setBodyHeight(body.offsetHeight);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(body);
    return () => ro?.disconnect();
  }, []);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const hold = useRef<{ members: string; positions: string; rotations: string; camera: string; frame: string; bounds: ScreenBounds; side?: CardSide } | null>(null);
  const adoptPositions = useRef(false);

  const place = useCallback(() => {
    const box = boxRef.current, header = headerRef.current;
    const proj = getActiveView()?.projection;
    const state = useEditorStore.getState();
    const gsLive = state.gridState;
    if (!box || !header || !proj || !gsLive) return;
    // Mid group rotation the members are briefly off the map; the card keeps its place and adopts
    // the members' new positions once the operation has finished.
    if (isGroupRotationInFlight()) { adoptPositions.current = true; return; }
    const sel = state.selection;
    const z = zoomRef.current;
    const vp = viewportSize();
    const size = { w: header.offsetWidth * z, h: header.offsetHeight * z, body: (bodyRef.current?.offsetHeight ?? 0) * z };
    const positions = memberPositions(sel, gsLive);
    // A move or a turn removes a member before placing it back; wait for it to land.
    if (hold.current && positions.includes('-')) return;
    const next = {
      members: sel.map((b) => (b.kind === 'object' ? b.id : `${b.x},${b.y}`)).join(','),
      positions,
      rotations: memberRotations(sel, gsLive),
      camera: cameraSignature(proj),
      frame: `${z}|${vp.width}x${vp.height}|${Math.round(size.w)}x${Math.round(size.h)}`,
    };
    const held = hold.current;
    const keep = !!held && held.members === next.members && held.camera === next.camera && held.frame === next.frame
      && (held.positions === next.positions || held.rotations !== next.rotations || adoptPositions.current);
    adoptPositions.current = false;
    const bounds = keep ? held!.bounds : selectionBounds(sel, gsLive, proj);
    if (!bounds) { box.style.visibility = 'hidden'; hold.current = null; return; }
    // While the camera moves over the same selection the card keeps its side instead of flipping.
    const prefer = held && held.members === next.members ? held.side : undefined;
    // A relocation of the card's own (a moved member, a new side, a new size) travels; following
    // the camera does not, or the card would trail the map it rides on.
    const travel = !!held && held.members === next.members && held.camera === next.camera && !reducedRef.current
      && box.style.visibility === 'visible';
    const from = travel ? visualRect(header) : null;
    if (!travel) { moveAnim.current?.cancel(); moveAnim.current = null; }
    const area = clearMapArea(vp);
    const p = placeSelectionCard(bounds, size, vp, area, undefined, undefined, prefer);
    hold.current = { ...next, bounds, side: p.visible ? p.side : undefined };
    if (!p.visible) { box.style.visibility = 'hidden'; return; }
    box.style.visibility = 'visible';
    box.dataset.grow = p.growUp ? 'up' : 'down';
    // Where nothing holds the whole opened card, the details scroll inside the room there is.
    const room = p.growUp ? p.top - area.top - CARD_MARGIN : area.bottom - CARD_MARGIN - p.top - size.h;
    box.style.setProperty('--details-max', `${Math.max(ROW * 2, room / z)}px`);
    const obj = sel.length === 1 && sel[0]!.kind === 'object' ? gsLive.objects.get(sel[0]!.id) ?? null : null;
    for (const arrow of box.querySelectorAll<SVGElement>('[data-facing]')) {
      arrow.style.transform = `rotate(${facingAngle(arrow.dataset.facing!, obj, proj)}deg)`;
    }
    box.style.left = `${p.left / z}px`;
    if (p.growUp) { box.style.top = 'auto'; box.style.bottom = `${(vp.height - p.top - size.h) / z}px`; }
    else { box.style.bottom = 'auto'; box.style.top = `${p.top / z}px`; }
    setGrowUp(p.growUp);
    // Applied now as well as on render, so the travel below measures the header where it will stand.
    (box.firstElementChild as HTMLElement | null)?.style.setProperty('flex-direction', p.growUp ? 'column-reverse' : 'column');
    const tail = tailRef.current;
    if (tail) {
      const lx = (p.tail.x - p.left) / z, ly = (p.tail.y - p.top) / z;
      // The pointer's centre sits on the header's selection-facing edge; half of it is inside the
      // plate's silhouette, so the shared outline runs from the plate down one side and back up.
      // ShapeEdge paints WebKit at double size, so lengths inside it double there.
      const k = isWebKitEngine() ? 2 : 1, half = TAIL / 2;
      const px = (v: number) => `${v * k}px`;
      const style: Record<string, string> = { left: '', right: '', top: '', bottom: '', width: px(TAIL), height: px(TAIL) };
      if (p.side === 'above' || p.side === 'below') {
        style.left = px(lx - half);
        style[p.side === 'above' ? 'bottom' : 'top'] = px(-half);
      } else {
        style[p.side === 'right' ? 'left' : 'right'] = px(-half);
        if (p.growUp) style.bottom = px(ROW - ly - half); else style.top = px(ly - half);
      }
      Object.assign(tail.style, style);
      const card = box.firstElementChild as HTMLElement | null;
      if (card) card.style.transformOrigin = p.side === 'right' ? `0 ${ly}px` : p.side === 'left' ? `100% ${ly}px` : `${lx}px ${p.growUp ? '100%' : '0'}`;
    }
    if (from) {
      // FLIP from where the header row was drawn, including any travel still under way.
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
  }, []);

  useLayoutEffect(() => {
    const state = useEditorStore.getState();
    const bus = state.eventBus;
    const onEvent = () => place();
    place();
    const offProjection = onProjectionChange(bus, onEvent, { objects: true });
    const header = headerRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && header ? new ResizeObserver(onEvent) : null;
    if (ro && header) ro.observe(header);
    // The card rides on the map: a wheel it does not use itself (only its details scroll) keeps
    // driving the map, so a touchpad pan or zoom does not stop when the pointer crosses the card.
    const box = boxRef.current;
    const onWheel = (e: WheelEvent) => {
      const scroller = scrollRef.current;
      if (scroller && e.target instanceof Node && scroller.contains(e.target) && !e.ctrlKey) {
        const room = e.deltaY > 0 ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop : scroller.scrollTop;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && room > 0) return;
      }
      forwardMapWheel(e);
    };
    box?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      offProjection();
      ro?.disconnect();
      box?.removeEventListener('wheel', onWheel);
    };
  }, [place]);

  // A chrome-scale change rescales the `zoom` subtree without emitting anything.
  useLayoutEffect(() => { place(); }, [zoom, locale, place]);

  const exec = () => useEditorStore.getState();
  const rotate = () => {
    const s = exec();
    if (!s.commandExecutor || !s.gridState) return;
    if (target.plural) {
      rotateGroupAction(s.commandExecutor, s.gridState, s.eventBus, selectedObjectIds(s.selection), 1);
      return;
    }
    if (target.sessionPlaza) {
      rotateSessionPlazaAction(s.eventBus);
      return;
    }
    const sel = singleSelection(s.selection);
    const cur = sel?.kind === 'object' ? s.gridState.objects.get(sel.id) : undefined;
    if (!cur || !getCatalogItem(cur.catalogId)?.rotatable) return;
    rotateObjectAction(s.commandExecutor, s.gridState, s.eventBus, cur, turnRotation(cur.rotation, 1), { from: cur.rotation, to: cur.rotation + 90 });
  };
  const face = (angle: Facing) => {
    const s = exec();
    const sel = singleSelection(s.selection);
    const cur = sel?.kind === 'object' ? s.gridState?.objects.get(sel.id) : undefined;
    const to = Number(angle) as Rotation;
    if (!cur || !s.commandExecutor || !s.gridState || cur.rotation === to) return;
    rotateObjectAction(s.commandExecutor, s.gridState, s.eventBus, cur, to, { from: cur.rotation, to });
  };
  const remove = () => {
    const s = exec();
    if (target.plural) {
      // A group has no confirm step, matching the delete shortcut; one undo restores it.
      const ids = selectedObjectIds(s.selection);
      if (s.commandExecutor && s.gridState && ids.length > 1) deleteSelection(s.commandExecutor, s.gridState, s.eventBus, t, ids);
      return;
    }
    // The confirmation the Delete shortcut opens, unrolled from this button.
    if (target.block) s.setDeletePopover(s.deletePopover ? null : target.block);
  };
  const narrow = (catalogId: string) => {
    const s = exec();
    const ids = selectedObjectIds(s.selection).filter((id) => s.gridState?.objects.get(id)?.catalogId === catalogId);
    if (ids.length) s.setSelection(ids.map((id) => ({ kind: 'object', id })));
  };

  // What the card says about its selection.
  let title = '';
  let thumb: ReactNode = null;
  const facts: [string, string][] = [];
  let kinds: { catalogId: string; name: string; icon?: string; n: number }[] = [];
  if (target.plural) {
    const members = groupMembers(gs, selectedObjectIds(useEditorStore.getState().selection));
    const byKind = new Map<string, number>();
    for (const m of members) byKind.set(m.catalogId, (byKind.get(m.catalogId) ?? 0) + 1);
    kinds = [...byKind].sort((a, b) => b[1] - a[1]).map(([catalogId, n]) => {
      const item = getCatalogItem(catalogId);
      return { catalogId, n, name: item ? localizedName(item.name, locale) : catalogId, icon: item?.icon ? iconUrl(item.icon) : undefined };
    });
    title = t('selection.items', { n: members.length });
    thumb = <Thumb src={kinds[0]?.icon} count={members.length} />;
    facts.push([t('selection.kinds'), String(kinds.length)]);
    facts.push([t('selection.load'), formatLoad(locale, members.reduce((sum, m) => sum + (getCatalogItem(m.catalogId)?.loadValue ?? 0), 0), members.some((m) => getCatalogItem(m.catalogId)?.loadUnknown))]);
    facts.push([t('selection.count'), String(members.length)]);
  } else if (target.object) {
    const obj = target.object;
    const item = getCatalogItem(obj.catalogId);
    const size = getPlacedObjectSize(obj);
    let placed = 0;
    for (const o of gs.objects.values()) if (o.catalogId === obj.catalogId) placed++;
    title = item ? localizedName(item.name, locale) : obj.catalogId;
    thumb = <Thumb src={item?.icon ? iconUrl(item.icon) : undefined} color={item?.color} />;
    facts.push([t('selection.size'), `${size.w}×${size.h}`]);
    facts.push([t('selection.load'), formatLoad(locale, item?.loadValue ?? 0, item?.loadUnknown)]);
    facts.push([t('selection.placed'), item?.maxCount ? `${placed}/${item.maxCount}` : String(placed)]);
    facts.push([t('selection.layer'), layerName(t, obj.elevation)]);
  } else if (target.block?.kind === 'terrain') {
    const terrain = getCell(gs.cells, target.block.x, target.block.y)?.terrain;
    const mountain = terrain?.type === TerrainType.Mountain;
    title = t(mountain ? 'mode.mountain' : 'mode.water');
    thumb = <Thumb src={MODES.find((m) => m.id === (mountain ? 'mountain' : 'water'))?.src} />;
    if (terrain) facts.push([t('selection.layer'), layerName(t, mountain ? surfaceElevation(terrain) : terrain.elevation)]);
  }
  const facing = target.object && target.rotatable && !target.sessionPlaza ? String(target.object.rotation) as Facing : null;
  const proj = getActiveView()?.projection;

  const arrive = 1 - amplitude('selection.card.arrive');
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={framerMotion('selection.fade')}
    >
      <div
        ref={boxRef}
        {...helpTargetAttr('select')}
        data-testid="selection-card"
        style={{
          position: 'fixed', zIndex: z.canvasControls, zoom, ...weights,
          visibility: 'hidden', pointerEvents: 'none',
        }}
      >
        <motion.div
          initial={{ scale: arrive, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: arrive, opacity: 0, transition: exitTransition }}
          transition={framerMotion('selection.card.arrive')}
          style={{
            display: 'flex', flexDirection: growUp ? 'column-reverse' : 'column', width: 'max-content',
            position: 'relative', color: INK, fontFamily: font.family, pointerEvents: 'auto',
          }}
        >
          {/* The plate and its pointer are ONE silhouette under the map's hairline, so the outline
              runs on around the pointer without a seam wherever the pointer stands. */}
          <ShapeEdge style={{ position: 'absolute', inset: 0 }}>
            <span style={{ position: 'absolute', inset: 0, background: PLATE, borderRadius: (ROW / 2) * (isWebKitEngine() ? 2 : 1) }} />
            <span ref={tailRef} style={{ position: 'absolute', background: PLATE, borderRadius: 3 * (isWebKitEngine() ? 2 : 1), transform: 'rotate(45deg)' }} />
          </ShapeEdge>
          <div ref={headerRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', height: ROW, padding: '0 6px 0 6px', gap: 4, width: 'max-content' }}>
            {thumb}
            <motion.button
              type="button"
              data-testid="selection-details"
              {...interactionProfiles.pill}
              aria-expanded={open}
              aria-label={`${title}, ${t('selection.details')}`}
              onClick={() => setOpen((v) => !v)}
              style={{ ...btnReset, display: 'flex', alignItems: 'center', gap: 4, height: BUTTON, padding: '0 8px 0 6px', borderRadius: radii.pill, color: PLATE_INK }}
            >
              <span style={{ ...roleFont('head'), maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
              <motion.svg aria-hidden viewBox="0 0 24 24" width={13} height={13} animate={{ rotate: open !== growUp ? 180 : 0 }} transition={springs.stiff} style={{ color: skin.muted, flex: 'none' }}>
                <path d="M 6 9 L 12 15.4 L 18 9" fill="none" stroke="currentColor" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" />
              </motion.svg>
            </motion.button>
            <span aria-hidden style={{ width: 1, alignSelf: 'stretch', margin: '12px 4px', background: LINE, flex: 'none' }} />
            {target.rotatable && (
              <motion.button type="button" data-testid="handle-rotate" {...interactionProfiles.tile} style={iconButton} onClick={rotate} aria-label={t('a11y.rotate')} title={t('a11y.rotate')}>
                <RotateIcon />
              </motion.button>
            )}
            {target.pickable && (
              <motion.button type="button" data-testid="handle-pick" {...interactionProfiles.tile} style={iconButton} onClick={pickSelection} aria-label={t('a11y.pick_material')} title={t('a11y.pick_material')}>
                <PickIcon />
              </motion.button>
            )}
            {target.deletable && (
              <motion.button type="button" data-testid="handle-delete" data-selection-delete {...interactionProfiles.tile} style={{ ...iconButton, color: colors.statusError }} onClick={remove} aria-label={t('a11y.delete')} title={t('a11y.delete')}>
                <TrashIcon />
              </motion.button>
            )}
          </div>
          {/* The body keeps its natural height laid out while closed, so the row is placed where the
              opened card will fit. It takes the header's width rather than widening the card. */}
          <div ref={scrollRef} style={{ position: 'relative', width: 0, minWidth: '100%', maxHeight: 'var(--details-max)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
            <motion.div
              initial={false}
              animate={{ height: open ? bodyHeight : 0, opacity: open ? 1 : 0 }}
              transition={framerMotion('panel.detail.unfold', reduced)}
              aria-hidden={!open || undefined}
              {...(open ? {} : { inert: '' })}
              style={{ overflow: 'hidden', pointerEvents: open ? undefined : 'none' }}
            >
              <div ref={bodyRef} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: growUp ? '12px 12px 4px' : '4px 12px 12px' }}>
                <div aria-hidden style={{ height: 1, background: LINE, margin: '0 4px', order: growUp ? 9 : 0 }} />
                {facts.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${facts.length > 1 ? 2 : 1}, minmax(0, 1fr))`, gap: 8 }}>
                    {facts.map(([label, value]) => <Fact key={label} label={label} value={value} />)}
                  </div>
                )}
                {kinds.length > 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {kinds.slice(0, 5).map((k) => (
                      <motion.button key={k.catalogId} type="button" {...interactionProfiles.row} onClick={() => narrow(k.catalogId)}
                        aria-label={t('selection.only_kind', { name: k.name })}
                        style={{ ...btnReset, display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 12px 0 4px', borderRadius: radii.md, background: INSET, color: PLATE_INK, ...roleFont('label') }}>
                        <Thumb src={k.icon} />
                        <span style={{ flex: 1, minWidth: 0, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.name}</span>
                        <span style={{ color: skin.muted }}>×{k.n}</span>
                      </motion.button>
                    ))}
                  </div>
                )}
                {facing && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ ...roleFont('head'), color: skin.muted, marginRight: 'auto' }}>{t('selection.facing')}</span>
                    <SegmentedControl<Facing>
                      value={facing}
                      options={FACINGS}
                      onChange={face}
                      idPrefix="selection-facing"
                      stretch={false}
                      render={(o) => <FacingArrow facing={o} deg={facingAngle(o, target.object, proj)} />}
                      label={(o) => `${t('selection.facing')} ${t(`context.rotate_${o}`)}`}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
