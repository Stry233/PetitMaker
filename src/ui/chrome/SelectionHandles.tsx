/*
 * SelectionHandles.tsx — Figma-style corner buttons on the selection box:
 * rotate (top-left, rotatable objects only) + delete (top-right, for objects
 * and peelable terrain cells). The selection rectangle itself is drawn in
 * PixiJS world space; these HTML buttons
 * are anchored to the same screen rect and re-tracked imperatively on every
 * viewport-changed / objects-changed event (React gets no per-frame signal), so
 * they follow pan, zoom, drag and rotation without re-rendering each frame.
 *
 * RE-TRACKING IS EVENT-DRIVEN, so anything that moves the target WITHOUT emitting an event has to be
 * named explicitly or the handles keep coordinates from before it. Three such things exist: the
 * CHROME SCALE (Ctrl +/-, the Settings slider, a persisted zoom restored on load — these change the
 * `zoom` subtree the box renders in, so its divided-out coords are stale the moment the scale moves;
 * a plain React value, so an effect keyed on it covers it), a window RESIZE (its own listener, since
 * it moves the projection without touching React state), and the ACTIVE VIEW (a 2D↔3D swap replaces
 * the projection entirely; the new view emits viewport-changed only once its camera moves).
 *
 * The active view is taken from `onActiveViewChange`, NOT from `viewMode`: the handles project
 * through whichever view is REGISTERED, and that registration does not coincide with the store flip.
 * A layout effect keyed on `viewMode` runs before the passive effect that registers 2D, and the 3D
 * scene registers a whole lazy import later, so keying on the mode re-tracks against the OUTGOING
 * projection and leaves the buttons at the old view's coordinates.
 *
 * A PLURAL selection (2+ members) swaps to a group mode: a fixed-size control ROW (rotate, a count
 * badge, delete) floating above ONE anchor POINT — the centre of the group's macro footprint bounds,
 * which is also the point `rotateGroup` turns the body about (both the button and the `,`/`.`
 * keyboard shortcut run through the one shared `group-rotate-action.ts:rotateGroupAction`). Both
 * corners show unconditionally, so the refusal from `rotateGroup`/`deleteGroup` names the blocker
 * instead of a hidden button leaving the user to guess. Terrain never joins a plural selection, so
 * `selection.length > 1` is all objects by construction.
 *
 * THE INVARIANT the group mode exists to keep (it was once a projected bounding box, and that is the
 * bug): fixed-size UI must never be positioned from a projected BOX. A box's screen extents are a
 * function of the camera — orbit until the group's long axis points away and it collapses to a
 * sliver, dolly in and it outgrows the viewport — so buttons pinned to its corners converge, then
 * vanish, then wander off the top of the screen, none of which the user asked for. A POINT projects
 * predictably under any camera. Size, spacing and lift are therefore CONSTANTS
 * (`selection-handles-layout.ts`); the camera decides only where the row sits, and the row is
 * clamped into the viewport so it stays reachable. It hides only when the ANCHOR is unusable
 * (behind the camera or off-screen) — there is no box left to degenerate. Escape deselects either way.
 *
 * THE ANCHOR HOLDS STILL ACROSS A ROTATION: this row is a control surface, not part of the scene —
 * the same argument that keeps it off the rotation's own arc animation. A quarter turn returns every
 * member to the same footprint bounds, but the half-cell lattice snap `rotationPivot` applies flips
 * direction with the box's aspect, and a member's own extent swaps as it turns, so recomputing the
 * anchor from the live bounds on every `objects-changed` made the row creep a fraction of a cell per
 * click — a button that moves cannot be clicked twice in a row. `reposition`'s group branch therefore
 * caches the anchor in `groupAnchorRef`, keyed by membership, and only feeds it a freshly recomputed
 * point when the membership changed OR `group-rotate-action.ts`'s own rotate call is not in flight —
 * so a genuine group MOVE (which really does relocate the selection) still tracks, a membership
 * change still tracks, and only the rotation's own geometry churn is held frozen. Four turns are a
 * rigid-body identity (every member lands back exactly home), so a frozen anchor is trivially back
 * where it started too.
 *
 * The single-selection anchor (2D footprint or the 3D body box below) keeps its exact box-derived
 * placement: one object's box is small and camera-stable, and pinning to its real corners is what
 * makes a single object's handles read as grabbing that object.
 *
 * Stacks at `z.canvasControls` — above the canvas, BELOW the floating panels and spokes: a control
 * that follows the camera must never cover chrome the user deliberately opened.
 *
 * Styled with the cozy tokens (panelCream, float shadow) + framer-motion springs
 * to match the floating zoom/history controls.
 */
import { useChromeScale } from '../menu/scale';
import { useCursorCss } from '../cursors/cursor-vars';
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEditorStore } from '../../state/store';
import { singleSelection, selectedObjectIds } from '../../state/selection';
import { useT } from '../../i18n/context';
import { getCatalogItem } from '../../state/catalog';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { rotateObjectAction } from './object-actions';
import { groupMembers, groupBounds, deleteGroup, reportDeleteGroup } from './group-actions';
import { rotateGroupAction, isGroupRotationInFlight } from './group-rotate-action';
import { getCell } from '../../core/model/grid-model';
import { colors, font, radii, shadows, springs, cursors, z } from '../styles';
import { getActiveView, onActiveViewChange } from '../../canvas/active-view';
import { TILE_SIZE } from '../../core/model/constants';
import { placeControlRow, groupRowMetrics, type RowMetrics } from './selection-handles-layout';

// SINGLE selection only: the handle diameter tracks the map zoom (so it stays proportional to the one
// object's box it is pinned to), clamped so it's never unusably small or oversized. The GROUP row
// takes no zoom term at all — see the file header's invariant.
const BTN_BASE = 32, BTN_MIN = 20, BTN_MAX = 44;
const handleSize = (zoom: number) =>
  Math.round(Math.max(BTN_MIN, Math.min(BTN_MAX, BTN_BASE * zoom)));
const currentZoom = (): number =>
  (getActiveView()?.projection.cellToScreen(0, 0).scale ?? TILE_SIZE) / TILE_SIZE;

// The round cream face both modes share; only the POSITIONING idiom differs below.
const handleFace = (danger: boolean, size: number): CSSProperties => ({
  width: size,
  height: size,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  background: colors.panelCream,
  color: danger ? colors.statusError : colors.frameDark,
  border: 'none',
  cursor: cursors.clickable,
  padding: 0,
  boxShadow: shadows.float,
  pointerEvents: 'auto',
  WebkitTapHighlightColor: 'transparent',
});

// SINGLE selection: pinned to a corner of the object's own box.
const cornerHandleStyle = (danger: boolean, corner: 'left' | 'right', size: number): CSSProperties => ({
  ...handleFace(danger, size),
  position: 'absolute',
  top: 0,
  ...(corner === 'left' ? { left: 0, marginLeft: -size / 2 } : { right: 0, marginRight: -size / 2 }),
  marginTop: -size / 2, // centre the button on the box corner (margins, so framer's scale transform stays free)
});

// GROUP: an item in the control row, laid out by the row's flexbox. No box, no corners, so no
// camera term can reach the distance between two buttons.
const rowHandleStyle = (danger: boolean, size: number): CSSProperties => ({
  ...handleFace(danger, size),
  flex: '0 0 auto',
});

// The plural-selection count: a bare number, so it carries no i18n copy. Sits between the two
// buttons, at the width `groupRowMetrics` predicted (an explicit width, so the row's measured size
// and the clamp's arithmetic can never disagree).
const countBadgeStyle = (size: number, width: number): CSSProperties => ({
  flex: '0 0 auto',
  width,
  height: Math.round(size * 0.72),
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: radii.pill,
  background: colors.panelCream,
  color: colors.frameDark,
  // Without the family this inherits the UA serif, which no other chrome uses.
  fontFamily: font.family,
  fontWeight: 800,
  fontSize: Math.max(11, Math.round(size * 0.4)),
  boxShadow: shadows.float,
  pointerEvents: 'none',
});

const RotateIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 11a8 8 0 1 0-2.1 5.4" />
    <path d="M20 4v6h-6" />
  </svg>
);

const TrashIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6.5 7l1 12.2a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9L18.5 7" />
  </svg>
);

export function SelectionHandles() {
  const t = useT();
  // Rotate is a spatial action (like an orbit drag), not a plain button click.
  const orbitCursor = useCursorCss('orbit');
  // `block` below stays the SINGLE-selection reading: null for 0 or 2+ members.
  const selection = useEditorStore((s) => s.selection);
  const plural = selection.length > 1;
  const block = plural ? null : singleSelection(selection);
  const gridState = useEditorStore((s) => s.gridState);
  const eventBus = useEditorStore((s) => s.eventBus);
  const boxRef = useRef<HTMLDivElement>(null);
  const chrome = useChromeScale();
  // The rect tracker runs imperatively (outside render) — read the zoom via a ref.
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  // GROUP anchor cache: the control row is a control surface, not part of the scene, so its anchor
  // holds still across a rotation (see `reposition`'s group branch) — keyed by membership so a
  // different selection always recomputes.
  const groupAnchorRef = useRef<{ key: string; x: number; y: number } | null>(null);
  const [btnSize, setBtnSize] = useState(() => handleSize(currentZoom()));
  const [anchors, setAnchors] = useState<{ left: { x: number; y: number }; right: { x: number; y: number } } | null>(null);
  // Whether the selection is currently projectable on-screen. The tracker box stays MOUNTED while a
  // deletable target is selected (so reposition keeps running and can recover); this just toggles
  // its visibility, so an off-camera object hides its handles instead of stranding them at a
  // sign-flipped, wrong position.
  const [handlesVisible, setHandlesVisible] = useState(true);

  // Resolve the selection target: a placed object, or a peelable terrain cell
  // (bare ground has no terrain → not peelable → no handle).
  const obj = block?.kind === 'object' && gridState ? gridState.objects.get(block.id) ?? null : null;
  const item = obj ? getCatalogItem(obj.catalogId) : null;
  const terrain = block?.kind === 'terrain' && gridState
    ? getCell(gridState.cells, block.x, block.y)?.terrain ?? null
    : null;
  const rotatable = !!item?.rotatable;       // objects only
  const deletable = (!!obj && !obj.locked) || !!terrain; // locked objects (the plaza) offer no delete
  const targetKey = block?.kind === 'object' ? block.id
    : block?.kind === 'terrain' ? `t:${block.x},${block.y}`
    // A group has no single id, so a member signature keys the tracker and re-attaches it on every
    // membership change.
    : plural ? `g:${selectedObjectIds(selection).join(',')}`
    : undefined;

  // Track the target's screen position imperatively (no per-frame re-render). Stable across renders:
  // everything camera- or store-shaped is read fresh at call time (via the store and `chromeRef`), so
  // the effects below can depend on it without re-subscribing on every render.
  const reposition = useCallback(() => {
    const el = boxRef.current;
    const proj = getActiveView()?.projection;
    if (!el || !proj) return;
    const sel = useEditorStore.getState().selection;
    // The chrome zoom the box renders under. Every coordinate assigned below is VISUAL px divided
    // by it, and it is read HERE (not captured) so a scale change repositions to the new scale.
    const chromeZoom = chromeRef.current;

    // GROUP: a fixed-size row above ONE projected point — the centre of the members' macro bounds,
    // the same point a group rotation turns about. `groupMembers` drops stale ids; an empty result
    // hides rather than pointing at nothing.
    if (sel.length > 1) {
      const gs = useEditorStore.getState().gridState;
      const members = gs ? groupMembers(gs, selectedObjectIds(sel)) : [];
      if (members.length === 0) {
        // A group op removes every member before placing any of it back (see `applyGroupTransform`),
        // so this fires as a transient MID-OPERATION state during the op's own rotation too — not
        // just a real "the group is gone". Only drop the cached anchor outside that window, or the
        // frozen pre-rotation point would be lost and the next (still in-flight) reposition would
        // recompute from whichever member happens to have landed first, an arbitrary partial bounds.
        if (!isGroupRotationInFlight()) groupAnchorRef.current = null;
        setHandlesVisible(false);
        return;
      }
      setAnchors(null);
      // This row is a control surface, not part of the scene: a rotation returns the members to the
      // same footprint bounds (modulo the half-cell snap direction, which alternates turn to turn —
      // rotationPivot's `wide` sign flips whenever the box's aspect flips), so recomputing on every
      // objects-changed made the row creep under a burst of clicks. The anchor therefore holds still
      // for as long as the membership (`key`) is unchanged, EXCEPT while this module's own rotation
      // call is in flight — a genuine group MOVE, or any other membership-preserving edit, still
      // recomputes fresh, and the two are idempotent there, so freezing changes nothing but the
      // rotation case. Precise geometry tracking is worth less than a stable click target: the same
      // argument already keeps this row off the rotation's own arc animation.
      const key = selectedObjectIds(sel).join(',');
      const cached = groupAnchorRef.current;
      const anchorWorld = cached && cached.key === key && isGroupRotationInFlight()
        ? { x: cached.x, y: cached.y }
        : (() => {
          const bounds = groupBounds(members);
          return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
        })();
      groupAnchorRef.current = { key, x: anchorWorld.x, y: anchorWorld.y };
      const anchor = proj.cellToScreen(anchorWorld.x, anchorWorld.y);
      // Row size comes from the member COUNT alone (no camera term), and the placement only decides
      // where that row sits — clamped into the viewport, hidden when the anchor itself is unusable.
      // Pure decision in selection-handles-layout.ts.
      const placement = placeControlRow(
        anchor,
        groupRowMetrics(sel.length),
        { width: window.innerWidth, height: window.innerHeight },
        chromeZoom,
      );
      if (!placement.visible) { setHandlesVisible(false); return; }
      el.style.left = `${placement.left}px`;
      el.style.top = `${placement.top}px`;
      setHandlesVisible(true);
      return;
    }
    const b = singleSelection(sel);

    // 3D object: anchor the handles to the rendered body box (rotate/delete sit at the body's top
    // corners, not the ground). A null box means the object is off-camera (behind the camera / not
    // projectable) — HIDE the handles rather than place them at a sign-flipped, wrong position.
    if (b?.kind === 'object' && typeof proj.objectScreenBox === 'function') {
      const bodyBox = useEditorStore.getState().gridState?.objects.get(b.id) ? proj.objectScreenBox(b.id) : null;
      if (!bodyBox) { setHandlesVisible(false); return; }
      el.style.left = `${bodyBox.x / chromeZoom}px`;
      el.style.top = `${bodyBox.y / chromeZoom}px`;
      el.style.width = `${bodyBox.w / chromeZoom}px`;
      el.style.height = `${bodyBox.h / chromeZoom}px`;
      // Buttons pin to the top face's projected corners (box-relative).
      setAnchors({
        left: { x: (bodyBox.anchors.left.x - bodyBox.x) / chromeZoom, y: (bodyBox.anchors.left.y - bodyBox.y) / chromeZoom },
        right: { x: (bodyBox.anchors.right.x - bodyBox.x) / chromeZoom, y: (bodyBox.anchors.right.y - bodyBox.y) / chromeZoom },
      });
      setBtnSize(handleSize(bodyBox.scale / TILE_SIZE));
      setHandlesVisible(true);
      return;
    }

    // 2D object / terrain (any view): a footprint (or 1-cell) box via cellToScreen.
    setAnchors(null);
    let pos: { x: number; y: number };
    let dim: { w: number; h: number };
    if (b?.kind === 'object') {
      const cur = useEditorStore.getState().gridState?.objects.get(b.id);
      if (!cur) { setHandlesVisible(false); return; }
      pos = cur.position;
      dim = getPlacedObjectSize(cur);
    } else if (b?.kind === 'terrain') {
      // Terrain renders on the micro-grid (offset −HALF_TILE = −0.5 macro cells), so the box sits
      // half a cell up-left of the macro coord — match it so the handle lands on the box corner.
      pos = { x: b.x - 0.5, y: b.y - 0.5 };
      dim = { w: 1, h: 1 };
    } else { setHandlesVisible(false); return; }
    const tl = proj.cellToScreen(pos.x, pos.y);
    const br = proj.cellToScreen(pos.x + dim.w, pos.y + dim.h);
    const w = br.x - tl.x, h = br.y - tl.y;
    // A non-positive extent means the projection wrapped (the cell is behind the camera in 3D):
    // hide rather than draw a flipped box at a wrong spot.
    if (!(w > 0 && h > 0)) { setHandlesVisible(false); return; }
    // tl/br are VISUAL px from the viewport; the box renders under the chrome zoom, so divide it
    // out of the css coords (same pattern as HelpBubble).
    el.style.left = `${tl.x / chromeZoom}px`;
    el.style.top = `${tl.y / chromeZoom}px`;
    el.style.width = `${w / chromeZoom}px`;
    el.style.height = `${h / chromeZoom}px`;
    setBtnSize(handleSize(tl.scale / TILE_SIZE));
    setHandlesVisible(true);
  }, []);

  // The event-driven track: a (re)select places the handles before paint, then the camera, the
  // objects and a view swap move them.
  useLayoutEffect(() => {
    if (!targetKey) return;
    reposition();
    eventBus.on('viewport-changed', reposition);
    eventBus.on('objects-changed', reposition);
    // A resize moves the projection without touching React state, so it needs its own listener.
    window.addEventListener('resize', reposition);
    // The 2D↔3D swap: re-track the moment the NEW view is registered (see the file header).
    const offView = onActiveViewChange(reposition);
    return () => {
      eventBus.off('viewport-changed', reposition);
      eventBus.off('objects-changed', reposition);
      window.removeEventListener('resize', reposition);
      offView();
    };
  }, [targetKey, eventBus, reposition]);

  // A chrome-scale change (Ctrl +/-, the Settings slider, a persisted zoom restored on load) rescales
  // the `zoom` subtree the box lives in and emits nothing, so without this the handles keep
  // coordinates computed under the old scale.
  useLayoutEffect(() => {
    if (targetKey) reposition();
  }, [chrome, targetKey, reposition]);

  const rotate = () => {
    // Read the LIVE object fresh from the store, not the render-closure `obj`:
    // this component repositions imperatively and does NOT re-render on object
    // changes, so the closure's rotation goes stale after the first rotate. Reading
    // fresh makes each click advance the CURRENT angle (so it cycles 0→90→180→270→0)
    // and validates the real next angle (so an impossible rotation surfaces a toast
    // instead of silently no-op'ing on a stale angle).
    const exec = useEditorStore.getState().commandExecutor;
    const gs = useEditorStore.getState().gridState;
    const sel = singleSelection(useEditorStore.getState().selection);
    if (!exec || !gs || sel?.kind !== 'object') return;
    const cur = gs.objects.get(sel.id);
    if (!cur || !getCatalogItem(cur.catalogId)?.rotatable) return;
    const angle = (((cur.rotation + 90) % 360) as 0 | 90 | 180 | 270);
    // Validate the rotated footprint BEFORE touching the object (the action
    // surfaces a toast and leaves it unchanged on a doomed rotation). Spin +90°
    // clockwise from the old angle so the direction is always consistent.
    rotateObjectAction(exec, gs, useEditorStore.getState().eventBus, cur, angle, { from: cur.rotation, to: cur.rotation + 90 });
  };

  const remove = () => {
    if (!block) return;
    // Open the same confirmation the Delete shortcut uses rather than deleting
    // outright — DeletePopover performs the removal + clears the selection.
    useEditorStore.getState().setDeletePopover(block);
  };

  // Turn the whole group 90° clockwise as one rigid body (this button only ever turns clockwise,
  // matching the single-object spin's direction convention). `rotateGroupAction` is the one call path
  // group-rotate-action.ts shares with the `,`/`.` keyboard shortcut, so the animation and any
  // refusal are identical whichever surface triggered the turn.
  const onRotateGroup = () => {
    const exec = useEditorStore.getState().commandExecutor;
    const gs = useEditorStore.getState().gridState;
    if (!exec || !gs) return;
    rotateGroupAction(exec, gs, useEditorStore.getState().eventBus, selectedObjectIds(useEditorStore.getState().selection), 1);
  };

  // Delete every unlocked member straight away, with no confirm popover, matching the
  // `selection.delete` shortcut for a plural selection. One undo entry restores the whole group.
  const deleteGroupAction = () => {
    const exec = useEditorStore.getState().commandExecutor;
    const gs = useEditorStore.getState().gridState;
    const ids = selectedObjectIds(useEditorStore.getState().selection);
    if (!exec || !gs || ids.length < 2) return;
    const result = deleteGroup(exec, gs, ids);
    useEditorStore.getState().setSelection(
      ids.filter((id) => gs.objects.has(id)).map((id) => ({ kind: 'object', id }) as const),
    );
    reportDeleteGroup(useEditorStore.getState().eventBus, t, result);
  };

  // Plural shows both corners unconditionally; single gates on having something to delete.
  const show = plural || deletable;

  // GROUP: the fixed row metrics (member count is the only input). SINGLE: the zoom-tracked corner
  // button on the object's own box.
  const row: RowMetrics | null = plural ? groupRowMetrics(selection.length) : null;
  const size = row ? row.btn : btnSize;

  // 3D anchor points (box-relative css px); null = 2D corner idiom.
  const anchorStyle = (a: { x: number; y: number } | null): CSSProperties =>
    a
      ? { position: 'absolute', left: a.x, top: a.y, marginLeft: -size / 2, marginTop: -size / 2 }
      : {};

  // The tracked box: `left`/`top` are assigned imperatively by `reposition`; its SIZE is declared
  // here for the group row (a constant) and imperatively for a single selection (its box).
  const trackedStyle: CSSProperties = {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: z.canvasControls,
    zoom: chrome,
    visibility: handlesVisible ? 'visible' : 'hidden',
    ...(row
      ? { display: 'flex', alignItems: 'center', gap: `${row.gap}px`, width: row.width, height: row.height }
      : { display: 'block' }),
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          // AnimatePresence's direct child must not carry a ref (framer reads
          // child.ref internally; React 18 warns) — the tracked box is nested.
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <div ref={boxRef} style={trackedStyle}>
          {(plural || rotatable) && (
            <motion.button
              type="button"
              data-testid="handle-rotate"
              style={row
                ? { ...rowHandleStyle(false, size), cursor: orbitCursor }
                : { ...cornerHandleStyle(false, 'left', size), cursor: orbitCursor, ...anchorStyle(anchors?.left ?? null) }}
              initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.9 }}
              transition={springs.bouncy}
              onClick={plural ? onRotateGroup : rotate}
              aria-label={t('a11y.rotate')}
            >
              <RotateIcon size={Math.round(size * 0.52)} />
            </motion.button>
          )}
          {row && (
            <div data-testid="selection-count" style={countBadgeStyle(size, row.badge)}>{selection.length}</div>
          )}
          <motion.button
            type="button"
            data-testid="handle-delete"
            style={row
              ? rowHandleStyle(true, size)
              : { ...cornerHandleStyle(true, 'right', size), ...anchorStyle(anchors?.right ?? null) }}
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
            whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.9 }}
            transition={springs.bouncy}
            onClick={plural ? deleteGroupAction : remove}
            aria-label={t('a11y.delete')}
          >
            <TrashIcon size={Math.round(size * 0.52)} />
          </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
