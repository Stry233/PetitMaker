/*
 * The standing quick-hints card. It renders whatever the resolver and the catalogue say about the
 * CURRENT state, so it holds no hint knowledge of its own: keys come from the keybind store, camera
 * verbs from the active view's caps, the scenario from store facts.
 *
 * Geometry: a fixed element at `right: 74` carrying the chrome zoom itself, never a wrapper. That
 * inset was measured to clear a 46px-wide control cluster at `right: 18` with a 10px gutter between
 * them; nothing stands there in this interface, so the number describes no neighbour until the card
 * is mounted beside one.
 *
 * Which map the hints describe comes from the ACTIVE VIEW, never from the store's `viewMode`: the
 * two are not simultaneous, since the 3D scene builds lazily and registers a frame or more after
 * the flip. Reading both from one source is what keeps the panel's promises honest in that window,
 * where a right-drag still pans. The caps and the 2D/3D split are the same fact asked twice.
 *
 * The two corner buttons write `hintLevel` through the store's own setter, the same field and the
 * same setter the Settings row uses, so the level has one home and the persistence comes with it.
 * They sit INSIDE the card, in a top padding band deepened to make room for them, rather than
 * overhanging its top-right corner: the gutter beside that corner is only as wide as whatever the
 * card is set next to leaves, which is not the card's to spend. Only they take a pointer; the card
 * stays `pointerEvents: 'none'` so a brush drag that starts over it reaches the map.
 *
 * The row swap's AnimatePresence key is the SCENARIO alone. A level change keeps the same list and
 * only reveals or hides its tail, so putting the level in the key would slide it sideways for a
 * change that is not a scenario change.
 *
 * The measurement is `scrollHeight`, never `getBoundingClientRect`: this subtree sits under the
 * chrome-scale CSS `zoom`, and rect-derived values are already multiplied by it, so a spring fed
 * from a rect converges on a height the zoomed ancestor then scales AGAIN. `scrollHeight` is in the
 * same local CSS-px space an inline `height` is read in. The target is arithmetic over two pieces
 * measured independently (the kept rows, and the tail), because the tail is still IN FLOW while it
 * fades out and measuring the live block would keep reporting the height the card is leaving.
 */
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { showToast } from '../../core/runtime/toast-bus';
import { useEditorStore } from '../../state/store';
import { useKeybinds } from '../../core/runtime/keybindings';
import { isCurveSessionOpen, subscribeCurveSession } from '../../tools/paint';
import { getActiveView, onActiveViewChange } from '../../canvas/active-view';
import { capsOf } from '../../canvas/interaction/camera-gestures';
import type { CameraCaps } from '../../core/interaction/camera-verbs';
import { getCatalogItem } from '../../state/catalog';
import { singleSelection } from '../../state/selection';
import { getCell } from '../../core/model/grid-model';
import { hasTrait } from '../../core/model/traits';
import { useChromeScale } from '../design/scale';
import { useT } from '../../i18n/context';
import { colors, cursors, font, pressable, shadows, springs, exitTransition, z } from '../design/styles';
import { resolveHintScenario, type SingleSelectionKind } from './scenario';
import { CONCISE_ROWS, rowsFor } from './catalogue';
import { HintTokens } from './tokens';

const FALLBACK_CAPS: CameraCaps = { canOrbit: false, wheelZooms: false };

function activeCaps(): CameraCaps {
  const cam = getActiveView()?.camera;
  return cam ? capsOf(cam) : FALLBACK_CAPS;
}

/* Quiet corner buttons: an ink glyph and nothing else. A cream face would be invisible on the cream
 * card and a shadow would read as a second surface, so what the selection handles get from their
 * face these get from restraint. Idle at 0.45 ink, full on hover.
 *
 * The mark and the target are different sizes: the glyph is 14 so it does not compete with the
 * rows, the box the user clicks is 24, the floor for a fingertip, and the 8px inset leaves room for
 * a flick that undershoots. */
const BTN_HIT = 24, BTN_GLYPH = 14, BTN_INSET = 8, BTN_CLEAR = 2, BTN_IDLE = 0.45;

/* Card geometry, in the panel's own CSS px. The buttons live in a top padding BAND rather than a
 * strip of their own, which is the cheaper of the two in height, and `PAD_TOP` is DERIVED from the
 * whole hit box so the band is exactly as deep as the thing it makes room for. That derivation is
 * also what keeps the measured height honest: the same `PAD_TOP` is both the card's CSS padding and
 * a term of the height target below, so the band can never be in the card but missing from the
 * number the spring animates to, and growing the target grows the band with no second edit.
 * Nothing here is measured from the buttons themselves — they are absolutely positioned and
 * contribute no layout, so a rows-only measurement plus these paddings IS the full card height. */
const PAD_TOP = BTN_INSET + BTN_HIT + BTN_CLEAR, PAD_X = 14, PAD_BOTTOM = 12, ROW_GAP = 8;

/** Everything the card is tall beyond its rows: the button band plus the bottom padding. */
export const CARD_CHROME = PAD_TOP + PAD_BOTTOM;

/** The height the card animates to, from the two row blocks measured on their own. Pass a tail
 *  height of 0 for "the tail is not part of the card right now", which is both the collapsed level
 *  and a scenario with no rows past the concise cut. Pure, so the arithmetic is testable without a
 *  layout engine — jsdom has none, and every measurement there is 0. */
export function cardHeightTarget(keptHeight: number, tailHeight: number): number {
  return CARD_CHROME + keptHeight + (tailHeight > 0 ? ROW_GAP + tailHeight : 0);
}

const cornerButton = (side: 'left' | 'right'): CSSProperties => ({
  position: 'absolute',
  top: BTN_INSET,
  ...(side === 'left' ? { left: BTN_INSET } : { right: BTN_INSET }),
  width: BTN_HIT,
  height: BTN_HIT,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'none',
  border: 'none',
  padding: 0,
  color: colors.frameDark,
  cursor: cursors.clickable,
  pointerEvents: 'auto',
  WebkitTapHighlightColor: 'transparent',
});

const ChevronIcon = ({ up }: { up: boolean }) => (
  <svg width={BTN_GLYPH} height={BTN_GLYPH} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
  </svg>
);

const CloseIcon = () => (
  <svg width={BTN_GLYPH} height={BTN_GLYPH} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 7l10 10" />
    <path d="M17 7L7 17" />
  </svg>
);

export function HintPanel() {
  const t = useT();
  const chrome = useChromeScale();
  const reduced = useReducedMotionConfig();
  const level = useEditorStore((s) => s.hintLevel);
  const setHintLevel = useEditorStore((s) => s.setHintLevel);
  const activeTool = useEditorStore((s) => s.activeTool);
  const designMode = useEditorStore((s) => s.designMode);
  const selection = useEditorStore((s) => s.selection);
  const gridState = useEditorStore((s) => s.gridState);
  const selectedItemId = useEditorStore((s) => s.selectedItemId);
  const selectingRegion = useEditorStore((s) => s.selectingRegion);
  const tourRunning = useEditorStore((s) => s.tourRunning);
  const portraitBlocked = useEditorStore((s) => s.portraitBlocked);
  const anyModal = useEditorStore((s) => Object.values(s.modals).some(Boolean));
  const overrides = useKeybinds((s) => s.overrides);
  const curveSessionOpen = useSyncExternalStore(subscribeCurveSession, isCurveSessionOpen);

  // The 2D view re-registers the same capabilities from a passive effect, so the signal fires far
  // more often than the answer changes; only a real change is worth a render.
  const [caps, setCaps] = useState<CameraCaps>(activeCaps);
  useEffect(() => onActiveViewChange(() => setCaps((prev) => {
    const next = activeCaps();
    return prev.canOrbit === next.canOrbit && prev.wheelZooms === next.wheelZooms ? prev : next;
  })), []);

  // What the one selected block can be offered. The deletability criterion is the selection
  // handles' own (`(obj && !obj.locked) || cell.terrain`), so the panel promises exactly the
  // corner buttons the user is looking at.
  const singleKind = useMemo<SingleSelectionKind | null>(() => {
    const one = singleSelection(selection);
    if (!one || !gridState) return null;
    if (one.kind === 'object') {
      const obj = gridState.objects.get(one.id);
      return obj && !obj.locked ? 'object' : 'inert';
    }
    return getCell(gridState.cells, one.x, one.y)?.terrain ? 'terrain' : 'inert';
  }, [selection, gridState]);

  const armedSpans = useMemo(() => {
    const item = selectedItemId ? getCatalogItem(selectedItemId) : undefined;
    return !!item && (hasTrait(item, 'waterSpan') || hasTrait(item, 'heightDrop'));
  }, [selectedItemId]);

  const scenario = resolveHintScenario({
    canOrbit: caps.canOrbit,
    activeTool, designMode, selectionCount: selection.length, singleKind,
    armedItemId: selectedItemId, armedSpans, curveSessionOpen, selectingRegion,
  });
  // The FULL list always: concise is the same list with its tail hidden, and the tail has to be
  // renderable for it to fade.
  const rows = rowsFor(scenario, overrides, caps, 'full');
  const kept = rows.slice(0, CONCISE_ROWS);
  const tail = rows.slice(CONCISE_ROWS);
  const collapsed = level === 'concise';
  const showTail = !collapsed && tail.length > 0;

  // The card's animated height. The two blocks are measured separately so the tail's height is known
  // while it is fading OUT, when it is still in flow but no longer part of the target. Before the
  // first measure lands (the first paint, or jsdom, which has no layout) both readings are 0 and the
  // card renders at the chrome-only height until real numbers arrive.
  //
  // The blocks are held as STATE through callback refs, not in a ref object: AnimatePresence can
  // swap the row block without re-rendering this component, and a plain ref would leave both the
  // measurement and the observer pointed at the node that just left. State means the attach itself
  // is the trigger.
  const [keptEl, setKeptEl] = useState<HTMLDivElement | null>(null);
  const [tailEl, setTailEl] = useState<HTMLDivElement | null>(null);
  const tailHeight = useRef(0);
  const [cardHeight, setCardHeight] = useState(0);

  const measure = useCallback(() => {
    if (!keptEl) return;
    if (tailEl) tailHeight.current = tailEl.scrollHeight;
    const next = cardHeightTarget(keptEl.scrollHeight, showTail ? tailHeight.current : 0);
    setCardHeight((prev) => (prev === next ? prev : next));
  }, [keptEl, tailEl, showTail]);

  // Before paint, on EVERY render (no dep list): the content moves with the scenario, the level, a
  // rebind, the locale and the caps, and re-listing those is a list that silently falls behind.
  useLayoutEffect(measure);

  // Content that reflows without a render of its own (a webfont landing, mostly) still has to move
  // the card. jsdom has no ResizeObserver; the measure above already ran there.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    if (keptEl) ro.observe(keptEl);
    if (tailEl) ro.observe(tailEl);
    return () => ro.disconnect();
  }, [measure, keptEl, tailEl]);

  // Not an early return: the card animates AWAY, so the component has to stay mounted long enough
  // to render the thing that is leaving. Every reason to be absent takes the same exit, which is
  // what makes opening a modal read as the panel stepping aside rather than blinking out.
  const present = level !== 'off' && !anyModal && !tourRunning && !portraitBlocked && rows.length > 0;

  const rowBlock = (list: typeof rows, from: number) => list.map((row, i) => (
    <div key={from + i} style={{ display: 'flex', alignItems: 'center', gap: ROW_GAP, minHeight: 24 }}>
      <HintTokens tokens={row.tokens} />
      <span style={{ fontSize: 13.5, fontWeight: 700, color: colors.frameDark, lineHeight: 1.25 }}>{t(row.textKey)}</span>
    </div>
  ));
  const column: CSSProperties = { display: 'flex', flexDirection: 'column', gap: ROW_GAP };

  return (
    <AnimatePresence>
      {present && (
      <motion.div
        // The panel grows from and shrinks toward the zoom cluster it sits beside, so the origin is
        // the corner nearest it. The scale rides the SHELL, not the card: the card's own transform
        // is spoken for by its height spring, and two owners of one property is a fight.
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1, transition: reduced ? { duration: 0 } : springs.stiff }}
        exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.92, transition: exitTransition }}
        style={{
          position: 'fixed', right: 74, bottom: 18, width: 240, zIndex: z.panel,
          zoom: chrome, pointerEvents: 'none', fontFamily: font.family,
          transformOrigin: '100% 100%',
        }}
      >
      <motion.div
        role="note"
        aria-label={t('a11y.hint_panel')}
        initial={false}
        animate={cardHeight > 0 ? { height: cardHeight } : undefined}
        transition={reduced ? { duration: 0 } : springs.stiff}
        style={{
          position: 'relative', boxSizing: 'border-box',
          background: colors.panelCream, borderRadius: 16, boxShadow: shadows.float,
          padding: `${PAD_TOP}px ${PAD_X}px ${PAD_BOTTOM}px`, overflow: 'hidden',
        }}
      >
        {/* Keyed on the SCENARIO alone: a level change keeps the same list and must not slide. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={scenario}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0, transition: reduced ? { duration: 0 } : springs.stiff }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: -12, transition: exitTransition }}
            style={column}
          >
            <div ref={setKeptEl} style={column}>{rowBlock(kept, 0)}</div>
            <AnimatePresence initial={false}>
              {showTail && (
                <motion.div
                  key="tail"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: reduced ? { duration: 0 } : springs.stiff }}
                  exit={{ opacity: 0, transition: reduced ? { duration: 0 } : exitTransition }}
                >
                  {/* The ref is here, not on the presence child: framer reads that child's own ref. */}
                  <div ref={setTailEl} style={column}>{rowBlock(tail, CONCISE_ROWS)}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
        <motion.button
          type="button"
          {...pressable}
          animate={{ opacity: BTN_IDLE }}
          whileHover={{ ...pressable.whileHover, opacity: 1 }}
          whileFocus={{ opacity: 1 }}
          style={cornerButton('left')}
          // `collapsed`, not `showTail`: a scenario of three rows or fewer has no tail at either
          // level, and the button still has to report which level the panel is in.
          onClick={() => setHintLevel(collapsed ? 'full' : 'concise')}
          aria-label={t(collapsed ? 'a11y.hint_expand' : 'a11y.hint_collapse')}
        >
          <ChevronIcon up={collapsed} />
        </motion.button>
        <motion.button
          type="button"
          {...pressable}
          animate={{ opacity: BTN_IDLE }}
          whileHover={{ ...pressable.whileHover, opacity: 1 }}
          whileFocus={{ opacity: 1 }}
          style={cornerButton('right')}
          // 'off' takes the panel off screen, so nothing is left there to say the hints can return.
          onClick={() => { setHintLevel('off'); showToast(t('toast.hints_off'), 'info'); }}
          aria-label={t('a11y.hint_close')}
        >
          <CloseIcon />
        </motion.button>
      </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
