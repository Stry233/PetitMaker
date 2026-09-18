import { viewportSize } from '../../../core/runtime/viewport-space';
/**
 * HTML pick/rotate/delete controls projected over the canvas selection. Repositioning follows viewport,
 * object, resize, chrome-scale, and active-view registration changes; `viewMode` may change before
 * the replacement projection is registered. A group uses a fixed row anchored at its rotation
 * pivot and clamped to the viewport. That anchor is cached while rotation changes object bounds so
 * repeated clicks do not move the controls. Single-selection toolbars sit above projected bounds.
 */
import { useChromeScale, useWeightVars, useReadableWeight } from '../../design/scale';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEditorStore } from '../../../state/store';
import { singleSelection, selectedObjectIds } from '../../../state/selection';
import { useT } from '../../../i18n/context';
import { getCatalogItem } from '../../../state/catalog';
import { subscribeMapStats } from '../../../state/map-stats';
import { pickedMaterial, pickSelection } from '../../../kit/pick-selection';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { groupMembers, groupBounds } from '../../../tools/objects';
import { rotateGroupAction, rotateObjectAction, deleteSelection, isGroupRotationInFlight } from '../../../kit/group-edit';
import { getCell } from '../../../core/model/grid-model';
import { colors, font, radii, shadows, cursors, pressable, z } from '../../design/styles';
import { TEXT_FLOOR } from '../../design/text-weight';
import { getActiveView, onActiveViewChange } from '../../../canvas/active-view';
import { helpTargetAttr } from '../modals/help/targets';
import { placeControlRow, placeSelectionRow, groupRowMetrics, singleRowMetrics } from './selection-handles-layout';

// Buttons share one face and leave the toolbar gaps transparent to map input.
const handleFace = (danger: boolean, size: number): CSSProperties => ({
  width: size,
  height: size,
  flex: '0 0 auto',
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

// The explicit width must match `groupRowMetrics` so viewport clamping uses the rendered size.
const countBadgeStyle = (size: number, width: number, weight: number): CSSProperties => ({
  flex: '0 0 auto',
  width,
  height: Math.round(size * 0.72),
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: radii.pill,
  background: colors.panelCream,
  color: colors.frameDark,
  // This non-button span otherwise inherits the browser serif.
  fontFamily: font.family,
  fontWeight: weight,
  fontSize: Math.max(TEXT_FLOOR, Math.round(size * 0.4)),
  boxShadow: shadows.float,
  pointerEvents: 'none',
});

const RotateIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 11a8 8 0 1 0-2.1 5.4" />
    <path d="M20 4v6h-6" />
  </svg>
);

const TrashIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6.5 7l1 12.2a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9L18.5 7" />
  </svg>
);

const PickIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m14 6 2.5-2.5a3 3 0 0 1 4 4L18 10" />
    <path d="m12 5 7 7M14 7l-9 9-1 4 4-1 9-9" />
  </svg>
);

export function SelectionHandles() {
  const t = useT();
  // `block` below stays the SINGLE-selection reading: null for 0 or 2+ members.
  const selection = useEditorStore((s) => s.selection);
  const plural = selection.length > 1;
  const block = plural ? null : singleSelection(selection);
  const gridState = useEditorStore((s) => s.gridState);
  const eventBus = useEditorStore((s) => s.eventBus);
  const [, repaint] = useReducer((n: number) => n + 1, 0);
  useEffect(() => selection.length > 0
    ? subscribeMapStats(eventBus, () => useEditorStore.getState().gridState, repaint)
    : undefined, [eventBus, selection.length]);
  const boxRef = useRef<HTMLDivElement>(null);
  const chrome = useChromeScale();
  const weightAt = useReadableWeight();
  const weights = useWeightVars();
  // The rect tracker runs imperatively (outside render) — read the zoom via a ref.
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  // GROUP anchor cache: the control row is a control surface, not part of the scene, so its anchor
  // holds still across a rotation (see `reposition`'s group branch) — keyed by membership so a
  // different selection always recomputes.
  const groupAnchorRef = useRef<{ key: string; x: number; y: number } | null>(null);
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
  const rotatable = !!item?.rotatable && !obj?.locked;
  const deletable = (!!obj && !obj.locked) || !!terrain; // locked objects (the plaza) offer no delete
  const pickable = pickedMaterial(gridState, selection) !== null;
  const row = plural ? groupRowMetrics(selection.length) : singleRowMetrics(Number(rotatable) + Number(pickable) + Number(deletable));
  const rowRef = useRef(row);
  rowRef.current = row;
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
      // The anchor holds still for as long as the membership (`key`) is unchanged, EXCEPT while this
      // module's own rotation call is in flight: a genuine group MOVE, or any other
      // membership-preserving edit, still recomputes fresh, and the two are idempotent there, so
      // freezing changes nothing but the rotation case. The file header has why it must hold still.
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
        { width: viewportSize().width, height: viewportSize().height },
        chromeZoom,
      );
      if (!placement.visible) { setHandlesVisible(false); return; }
      el.style.left = `${placement.left}px`;
      el.style.top = `${placement.top}px`;
      setHandlesVisible(true);
      return;
    }
    const b = singleSelection(sel);

    const place = (bounds: { x: number; y: number; w: number; h: number }) => {
      const placement = placeSelectionRow(bounds, rowRef.current, { width: viewportSize().width, height: viewportSize().height }, chromeZoom);
      if (!placement.visible) { setHandlesVisible(false); return; }
      el.style.left = `${placement.left}px`;
      el.style.top = `${placement.top}px`;
      setHandlesVisible(true);
    };

    if (b?.kind === 'object' && proj.objectScreenBox) {
      const body = useEditorStore.getState().gridState?.objects.has(b.id) ? proj.objectScreenBox(b.id) : null;
      if (!body) { setHandlesVisible(false); return; }
      place(body);
      return;
    }

    let pos: { x: number; y: number };
    let dim: { w: number; h: number };
    if (b?.kind === 'object') {
      const cur = useEditorStore.getState().gridState?.objects.get(b.id);
      if (!cur) { setHandlesVisible(false); return; }
      pos = cur.position;
      dim = getPlacedObjectSize(cur);
    } else if (b?.kind === 'terrain') {
      // Terrain's rendered footprint is shifted half a macro cell up-left.
      pos = { x: b.x - 0.5, y: b.y - 0.5 };
      dim = { w: 1, h: 1 };
    } else { setHandlesVisible(false); return; }
    // All four corners remain valid when an orbit reverses the projected axes.
    const corners = [
      proj.cellToScreen(pos.x, pos.y), proj.cellToScreen(pos.x + dim.w, pos.y),
      proj.cellToScreen(pos.x, pos.y + dim.h), proj.cellToScreen(pos.x + dim.w, pos.y + dim.h),
    ];
    if (corners.some(p => p.behind)) { setHandlesVisible(false); return; }
    const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
    place({ x, y, w: Math.max(...corners.map(p => p.x)) - x, h: Math.max(...corners.map(p => p.y)) - y });
  }, []);

  // The event-driven track: a (re)select places the handles before paint, then the camera, the
  // objects and a view swap move them.
  useLayoutEffect(() => {
    if (!targetKey) return;
    reposition();
    eventBus.on('viewport-changed', reposition);
    eventBus.on('objects-changed', reposition);
    eventBus.on('cells-changed', reposition);
    // A resize moves the projection without touching React state, so it needs its own listener.
    window.addEventListener('resize', reposition);
    // The 2D↔3D swap: re-track the moment the NEW view is registered (see the file header).
    const offView = onActiveViewChange(reposition);
    return () => {
      eventBus.off('viewport-changed', reposition);
      eventBus.off('objects-changed', reposition);
      eventBus.off('cells-changed', reposition);
      window.removeEventListener('resize', reposition);
      offView();
    };
  }, [targetKey, eventBus, reposition]);

  // A chrome-scale change (Ctrl +/-, the Settings slider, a persisted zoom restored on load) rescales
  // the `zoom` subtree the box lives in and emits nothing, so without this the handles keep
  // coordinates computed under the old scale.
  useLayoutEffect(() => {
    if (targetKey) reposition();
  }, [chrome, targetKey, row.width, reposition]);

  const rotate = () => {
    // Repeated clicks can arrive before a render, so rotation reads the live object.
    const exec = useEditorStore.getState().commandExecutor;
    const gs = useEditorStore.getState().gridState;
    const sel = singleSelection(useEditorStore.getState().selection);
    if (!exec || !gs || sel?.kind !== 'object') return;
    const cur = gs.objects.get(sel.id);
    if (!cur || !getCatalogItem(cur.catalogId)?.rotatable) return;
    const angle = (((cur.rotation + 90) % 360) as 0 | 90 | 180 | 270);
    // Validate the rotated footprint BEFORE touching the object (a doomed rotation
    // leaves it unchanged). Spin +90° clockwise from the old angle so the direction
    // is always consistent.
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
  // kit/group-edit.ts shares with the rotate keyboard shortcut, so the animation and any
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
    deleteSelection(exec, gs, useEditorStore.getState().eventBus, t, ids);
  };

  const show = plural || deletable || pickable;

  const size = row.btn;
  const iconSize = size / 2;

  // Camera updates write position imperatively; React owns the fixed toolbar dimensions.
  const trackedStyle: CSSProperties = {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: z.canvasControls,
    zoom: chrome,
    ...weights,
    visibility: handlesVisible ? 'visible' : 'hidden',
    display: 'flex', alignItems: 'center', gap: row.gap, width: row.width, height: row.height,
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
          <div ref={boxRef} {...helpTargetAttr('select')} style={trackedStyle}>
          {(plural || rotatable) && (
            <motion.button
              type="button"
              data-testid="handle-rotate"
              {...pressable}
              // No cursor of its own: it is a button, and the global rule gives every button the
              // clickable pointer. `orbit` means the 3D CAMERA turning, not an object being turned.
              style={handleFace(false, size)}
              initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              onClick={plural ? onRotateGroup : rotate}
              aria-label={t('a11y.rotate')}
            >
              <RotateIcon size={iconSize} />
            </motion.button>
          )}
          {plural && (
            <div data-testid="selection-count" style={countBadgeStyle(size, row.badge, weightAt(800, Math.max(TEXT_FLOOR, Math.round(size * 0.4))))}>{selection.length}</div>
          )}
          {pickable && (
            <motion.button
              type="button"
              data-testid="handle-pick"
              {...pressable}
              style={handleFace(false, size)}
              initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              onClick={pickSelection}
              aria-label={t('a11y.pick_material')}
              title={t('a11y.pick_material')}
            >
              <PickIcon size={iconSize} />
            </motion.button>
          )}
          {(plural || deletable) && <motion.button
            type="button"
            data-testid="handle-delete"
            {...pressable}
            style={handleFace(true, size)}
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
            onClick={plural ? deleteGroupAction : remove}
            aria-label={t('a11y.delete')}
          >
            <TrashIcon size={iconSize} />
          </motion.button>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
