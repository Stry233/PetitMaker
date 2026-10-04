/**
 * The planet session's nameplate: Back, the planet's name and Done on one plate at the top, on the
 * line the mode row's ink runs through. It stands centred on the window where the span between the
 * mode row and the corner allows, slides along that span where it does not, and past that the name
 * gives up width; Back and Done keep theirs.
 *
 * The toast band moves below the plate while it stands (`toastBandShift`).
 *
 * Back leaves at once while nothing has been drawn and otherwise asks from under the plate, starting
 * at its own end, before discarding. Done is unavailable until the planet has ground, and grows the
 * save panel from the plate; pressing the name opens the same panel at its name field, so the planet
 * is named in one place.
 */
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CellZone } from '../../../core/model/types';
import { ZONE_COLORS } from '../../../core/model/constants';
import { showToast } from '../../../core/runtime/toast-bus';
import { quantityParams, useT } from '../../../i18n/context';
import { sessionFrame, sessionHasGround } from '../../../kit/operations/planet-session';
import { useEditorStore } from '../../../state/store';
import { touchFloorZoom, useChromeScale, useDenseScript, useDevicePixelRatio, useTouchPrimary, useViewportSize } from '../../design/scale';
import { TOAST_BAND_SHIFT_VAR, TOAST_BAND_TOP } from '../../chrome/floating/toast-band';
import { ShapeEdge, isWebKitEngine } from '../../design/shape-edge';
import { btnReset, font, interactionProfiles, radii, z } from '../../design/styles';
import { roleFont, weightVars } from '../../design/text-weight';
import { INK, LINE, PLATE, PLATE_INK } from '../../design/tokens';
import { cozyPanel, skin, windowCard } from '../../design/window-skin';
import { ActionButton } from '../../primitives/ActionButton';
import { Switch } from '../../primitives/Switch';
import { AnchoredConfirm, anchoredCardMotion, anchoredOrigin } from '../../primitives/AnchoredConfirm';
import { useFloatingPosition } from '../../primitives/use-floating-position';
import { BackIcon, CheckIcon, EditIcon } from '../../primitives/line-glyphs';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { paintPlanet } from '../../primitives/planet-painter';
import { useSurfaceScope } from '../../primitives/surface-scope';
import { PlanetNameField, usePlanetNameReview } from '../../chrome/modals/planet/PlanetNameField';
import { MODE_ROW_INK_CENTRE, cornerArt, cornerWidth, modeRowRight, sessionModes, TOP_RIGHT_TOP, type FrameLayout } from '../frame';
import { useFrameLayout } from '../frame-layout';
import { EDGE_RIGHT, RAIL } from '../units';
import { useFrameZoom } from '../use-frame-zoom';
import { finishPlanetEditing, stopPlanetEditing, useSessionPlanetName } from './planet-editing';
import { useCanvasFact } from './use-canvas-fact';

/** The plate's height in css px; its ends are half-circles. */
export const PLATE_ROW = 52;
/** Each control on the plate and in its panel, in css px. */
const BUTTON = 44;
/** Inset of the controls from the plate's ends, and the space between them, in css px. */
const PLATE_PAD = 4;
const PLATE_GAP = 4;
/** The rule between Back and the name: inset from the plate's top and bottom, and its side air. */
const RULE_INSET = 12;
const RULE_AIR = 2;
const NAME_PAD = 12;
const NAME_GAP = 8;
const NAME_MAX_W = 220;
const PEN = 16;
/** The name button at its narrowest: its padding and the pen, with the name itself down to nothing. */
export const NAME_LEAST = 2 * NAME_PAD + NAME_GAP + PEN;
const TICK = 18;
const DONE_PAD = { start: 14, end: 18 };
const DONE_GAP = 6;
/** Space between the plate and the surfaces it opens, and between the plate and the toast band, in css px. */
const PANEL_GAP = 8;
const PANEL_PAD = 16;
/** The panel's width with its picture above the name, and beside it. */
const STACKED_W = 380;
const SIDE_W = 460;
/** The least room under the plate, in css px, the picture stands above the name in; a shorter
 *  window sets it beside the name. */
const STACKED_ROOM = 400;
const STACKED_SHOT_H = 160;
const SIDE_SHOT = { w: 168, h: 126 };
/** The picture's margin around the planet's land, in css px. */
const SHOT_MARGIN = 12;
const DISCARD_W = 360;
/** Padding of a scanned planet's review segment, between its rule and Done, in css px. */
const REVIEW_PAD = { start: 10, end: 6 };
const REVIEW_GAP = 8;

/**
 * Where the plate's box starts, in chrome css px: its middle on the mode row's ink centre, which
 * the frame draws at `frameZoom` while the plate draws at `chromeZoom`.
 */
export function nameplateTop(frameZoom: number, chromeZoom: number): number {
  return (MODE_ROW_INK_CENTRE * frameZoom) / chromeZoom - PLATE_ROW / 2;
}

/** Where the plate's box ends, in chrome css px. */
export function nameplateBottom(frameZoom: number, chromeZoom: number): number {
  return nameplateTop(frameZoom, chromeZoom) + PLATE_ROW;
}

/** The span the plate may stand in and the centre it keeps while it fits there, in screen px. */
export interface NameplateSpan { left: number; right: number; centre: number }

/**
 * Where the plate may stand across the window, in screen px: clear of the session's mode row
 * (its selected splat included) on the left and, while the corner stands level with the plate, of
 * the corner's controls on the right, each by the frame's least gap between groups.
 */
export function nameplateSpan(
  viewportW: number, frameZoom: number, chromeZoom: number,
  layout: Pick<FrameLayout, 'width' | 'edgeRight' | 'cornerTop'>, modes: number,
): NameplateSpan {
  const level = layout.cornerTop < nameplateBottom(frameZoom, chromeZoom) * chromeZoom / frameZoom;
  const corner = level ? cornerWidth(cornerArt(true)) + RAIL.groupMin : 0;
  return {
    left: (modeRowRight(modes) + RAIL.groupMin) * frameZoom,
    right: (layout.width - layout.edgeRight - corner) * frameZoom,
    centre: viewportW / 2,
  };
}

/** How far the toast band moves down while the plate stands, in chrome css px: to clear the plate. */
export function toastBandShift(frameZoom: number, chromeZoom: number): number {
  return Math.max(0, nameplateBottom(frameZoom, chromeZoom) + PANEL_GAP - TOAST_BAND_TOP);
}

/** Whether leaving would lose work: an edit, or a planet the session opened that is not saved yet
 *  (one read from a scan), which Back must not throw away unasked. */
const hasEdits = (): boolean => {
  const s = useEditorStore.getState();
  return (s.commandExecutor?.getUndoStackSize() ?? 0) > 0 || !!s.planetSession?.review;
};

const iconButton: CSSProperties = {
  ...btnReset, width: BUTTON, height: BUTTON, flex: 'none', borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK,
};

export function PlanetNameplate({ motionProps }: {
  /** The shell's chrome swap, so the plate arrives and leaves with the rest of the session pose. */
  motionProps?: Record<string, unknown>;
}) {
  const t = useT();
  const chrome = useChromeScale();
  // The plate is frame chrome and follows the chrome scale; what it opens is transient and
  // keeps a fingertip's target on a touch screen.
  const panelZoom = touchFloorZoom(chrome, useTouchPrimary(), BUTTON);
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();
  const plateWeights = weightVars(chrome, dpr, dense);
  const panelWeights = weightVars(panelZoom, dpr, dense);
  const frameZoom = useFrameZoom();
  const top = nameplateTop(frameZoom, chrome);
  const review = useEditorStore((s) => s.planetSession?.review);
  const shift = toastBandShift(frameZoom, chrome);
  const viewport = useViewportSize();
  const layout = useFrameLayout();
  const modes = useEditorStore((s) => sessionModes(s.planetSession).length);
  const span = nameplateSpan(viewport.w, frameZoom, chrome,
    layout ?? { width: viewport.w / frameZoom, edgeRight: EDGE_RIGHT, cornerTop: TOP_RIGHT_TOP }, modes);
  const editing = useEditorStore((s) => s.planetSession?.entryId != null);
  // The shown name follows the language and the background name check until the visitor types one.
  const fallback = useSessionPlanetName();
  const [draft, setDraft] = useState<string | null>(null);
  const [asking, setAsking] = useState<'discard' | 'save' | null>(null);
  // Bumped by a press on the name, so an open panel takes the keyboard to its field again.
  const [nameAsk, setNameAsk] = useState(0);
  const ground = useCanvasFact(sessionHasGround);
  const plateRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const close = () => setAsking(null);
  const name = draft ?? fallback;
  const shown = name.trim() || fallback;

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty(TOAST_BAND_SHIFT_VAR, `${shift}px`);
    return () => { root.removeProperty(TOAST_BAND_SHIFT_VAR); };
  }, [shift]);

  const back = () => {
    if (asking === 'discard') { close(); return; }
    if (hasEdits()) setAsking('discard');
    else stopPlanetEditing();
  };
  const rename = () => { setAsking('save'); setNameAsk((n) => n + 1); };
  const save = (asCopy: boolean) => {
    const trimmed = name.trim();
    if (!trimmed || !ground) return;
    const result = finishPlanetEditing(trimmed, asCopy);
    // A save that did not finish keeps the panel and the session, so nothing drawn is lost.
    if (result.ok) close();
    else showToast(t(result.reason === 'quota' ? 'planet.save_failed' : 'planet.finish_failed'), 'error');
  };

  const surface: CSSProperties = { fontFamily: font.family, color: INK, pointerEvents: 'auto' };
  // The spacers hold the plate on the window's centre while it fits, and the one on the wider side
  // gives way first when it does not. The assistant cannot dock during a session, so the window is
  // the frame.
  const lean = (span.centre - span.left) - (span.right - span.centre);
  const spacer = (basis: number): CSSProperties => ({ flex: `1 1 ${Math.max(0, basis) / chrome}px`, minWidth: 0 });

  // Portalled out of the frame, whose zoom and layout containment would otherwise scale the plate
  // a second time; each surface carries its own zoom.
  return createPortal(
    <>
      <motion.div
        {...motionProps}
        data-testid="planet-nameplate"
        style={{
          position: 'fixed', top, left: span.left / chrome, width: Math.max(0, span.right - span.left) / chrome,
          zoom: chrome, ...plateWeights, display: 'flex', pointerEvents: 'none', zIndex: z.panel,
        }}
      >
        <span aria-hidden style={spacer(lean)} />
        <div ref={plateRef} data-testid="planet-nameplate-plate" {...mapEdgeAttr('top')}
          style={{ ...surface, position: 'relative', flex: 'none', maxWidth: '100%' }}>
          <ShapeEdge style={{ position: 'absolute', inset: 0 }}>
            <span style={{ position: 'absolute', inset: 0, background: PLATE, borderRadius: (PLATE_ROW / 2) * (isWebKitEngine() ? 2 : 1) }} />
          </ShapeEdge>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: PLATE_GAP, height: PLATE_ROW, padding: `0 ${PLATE_PAD}px` }}>
            <motion.button ref={backRef} type="button" data-testid="planet-back" {...interactionProfiles.tile}
              aria-label={t('planet.back')} title={t('planet.back')} onClick={back} style={iconButton}>
              <BackIcon />
            </motion.button>
            <PlateRule />
            <motion.button type="button" data-testid="planet-name" {...interactionProfiles.pill}
              aria-label={t('planet.rename_named', { name: shown })} aria-expanded={asking === 'save'} onClick={rename} title={shown}
              style={{ ...btnReset, display: 'flex', alignItems: 'center', gap: NAME_GAP, height: BUTTON, padding: `0 ${NAME_PAD}px`, borderRadius: radii.pill, color: PLATE_INK, flex: '0 1 auto', minWidth: NAME_LEAST }}>
              <span style={{ ...roleFont('head'), minWidth: 0, maxWidth: NAME_MAX_W, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shown}</span>
              <span aria-hidden style={{ display: 'flex', color: skin.muted, flex: 'none' }}><EditIcon size={PEN} /></span>
            </motion.button>
            {review && <PlateRule />}
            {review && <ReviewSegment cells={review.cells.length} landmark={review.landmark} />}
            <ActionButton appearance="primary" interaction="pill" data-testid="planet-done"
              disabled={!ground} aria-expanded={asking === 'save'}
              onClick={() => setAsking(asking === 'save' ? null : 'save')}
              style={{ flex: 'none', height: BUTTON, paddingBlock: 0, paddingInline: `${DONE_PAD.start}px ${DONE_PAD.end}px`, borderRadius: radii.pill, display: 'flex', alignItems: 'center', gap: DONE_GAP, whiteSpace: 'nowrap' }}>
              <CheckIcon size={TICK} />
              {t('planet.done')}
            </ActionButton>
          </div>
        </div>
        <span aria-hidden style={spacer(-lean)} />
      </motion.div>
      <AnimatePresence>
        {asking === 'save' && (
          <SavePanel key="save" style={{ ...surface, zoom: panelZoom, ...panelWeights, zIndex: z.opened }}
            zoom={panelZoom} anchor={plateRef} trigger={plateRef}
            editing={editing} ground={ground} name={name} known={fallback} onName={setDraft} nameAsk={nameAsk}
            onSave={save} onCancel={close} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {asking === 'discard' && (
          <AnchoredConfirm key="discard" anchor={plateRef} trigger={backRef} align="start" zoom={panelZoom}
            width={DISCARD_W} helpTarget={{ page: 'planet' }} style={{ zoom: panelZoom, ...panelWeights }}
            title={t('planet.discard_title')} cancelLabel={t('planet.keep_editing')} confirmLabel={t('planet.discard')}
            onCancel={close} onConfirm={() => { close(); stopPlanetEditing(); }} />
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}

/** The rule between the plate's segments. */
function PlateRule() {
  return <span aria-hidden style={{ width: 1, alignSelf: 'stretch', margin: `${RULE_INSET}px ${RULE_AIR}px`, background: LINE, flex: 'none' }} />;
}

/** A scanned planet's segment of the plate: how many places to check, the landmark counted as one,
 *  and the switch that shows them on the map. Its title spells the count out. */
function ReviewSegment({ cells, landmark }: { cells: number; landmark: boolean }) {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const shown = useEditorStore((s) => s.planetReviewShown);
  const setShown = useEditorStore((s) => s.setPlanetReviewShown);
  const key = landmark
    ? (cells === 1 ? 'planet.review_count_landmark_one' : 'planet.review_count_landmark')
    : (cells === 1 ? 'planet.review_count_one' : 'planet.review_count');
  const full = t(key, quantityParams(locale, { n: cells }));
  return (
    <div data-testid="planet-review" title={full} style={{
      display: 'flex', alignItems: 'center', gap: REVIEW_GAP, height: BUTTON, flex: 'none', whiteSpace: 'nowrap',
      paddingInline: `${REVIEW_PAD.start}px ${REVIEW_PAD.end}px`,
    }}>
      <span data-testid="planet-review-count" style={{ ...roleFont('label'), color: PLATE_INK }}>
        {t('planet.review_short', quantityParams(locale, { n: cells + (landmark ? 1 : 0) }))}
      </span>
      <Switch on={shown} onClick={() => setShown(!shown)} label={t('planet.review_toggle')} />
    </div>
  );
}

function SavePanel({ style, zoom, anchor, trigger, editing, ground, name, known, onName, nameAsk, onSave, onCancel }: {
  style: CSSProperties;
  /** The zoom the panel draws at. */
  zoom: number;
  /** The plate the panel grows from and follows. */
  anchor: RefObject<HTMLElement | null>;
  trigger: RefObject<HTMLElement | null>;
  editing: boolean;
  /** Whether the planet has ground to save; the name stays editable without it. */
  ground: boolean;
  name: string;
  /** The name the planet already carries, or the generated default; it needs no check. */
  known: string;
  onName: (name: string) => void;
  nameAsk: number;
  onSave: (asCopy: boolean) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const present = useIsPresent();
  const reduced = useReducedMotionConfig() === true;
  const [stacked, setStacked] = useState(true);
  const floating = useFloatingPosition({ open: present, anchor, zoom, width: stacked ? STACKED_W : SIDE_W, gap: PANEL_GAP, align: 'center' });
  const ref = floating.ref;
  // The picture stands above the name where the window leaves the panel `STACKED_ROOM` under the
  // plate, read from the placement that also caps the panel's height.
  const room = floating.placement?.room;
  useLayoutEffect(() => { if (room !== undefined) setStacked(room >= STACKED_ROOM); }, [room]);
  const fieldRef = useRef<HTMLInputElement>(null);
  const [frame] = useState(() => { const s = useEditorStore.getState().gridState; return s ? sessionFrame(s) : null; });
  const check = usePlanetNameReview(present, name, known);
  const saveable = ground && check.approved;
  const submit = (asCopy: boolean) => { if (saveable) onSave(asCopy); };
  const title = t(editing ? 'planet.save_title_edit' : 'planet.save_title_new');

  useSurfaceScope({ open: present, root: ref, trigger, onClose: onCancel, focus: 'contain', outside: true });
  // After the surface's own initial focus, so the name is what the keyboard lands on.
  useEffect(() => { fieldRef.current?.focus(); fieldRef.current?.select(); }, [nameAsk]);

  const shot = stacked
    ? { width: '100%', height: STACKED_SHOT_H }
    : { width: SIDE_SHOT.w, height: SIDE_SHOT.h, flex: 'none' };
  const nameBlock = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 0 }}>
      {frame && (
        <span style={{ ...roleFont('note'), alignSelf: 'flex-start', padding: '4px 10px', borderRadius: radii.pill, background: skin.inset, color: skin.plateInk }}>
          {t('planet.chunks', { w: frame.cols, h: frame.rows })}
        </span>
      )}
      <PlanetNameField check={check} inputRef={fieldRef} value={name} onChange={onName} onSubmit={() => submit(false)} />
    </div>
  );

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={title}
      data-testid="planet-save-panel"
      {...anchoredCardMotion(reduced)}
      style={{
        ...cozyPanel, ...windowCard, ...style, ...floating.style, boxSizing: 'border-box',
        overflowX: 'hidden', overflowY: 'auto',
        transformOrigin: anchoredOrigin(!!floating.placement?.above, 'center', floating.placement?.anchorX),
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: PANEL_PAD }}>
        <div style={{ display: 'flex', flexDirection: stacked ? 'column' : 'row', gap: stacked ? 12 : 14 }}>
          <PlanetShot style={shot} />
          {nameBlock}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
          {editing && (
            <ActionButton appearance="tertiary" hoverFill={skin.inset} disabled={!saveable} style={{ ...choice, marginInlineEnd: 'auto' }} onClick={() => submit(true)}>
              {t('planet.save_copy')}
            </ActionButton>
          )}
          <ActionButton appearance="secondary" style={choice} onClick={onCancel}>{t('planet.keep_editing')}</ActionButton>
          <ActionButton appearance="primary" disabled={!saveable} style={choice} onClick={() => submit(false)}>
            {t('planet.save_title_new')}
          </ActionButton>
        </div>
      </div>
    </motion.div>
  );
}

const choice: CSSProperties = { flex: '0 1 auto', minWidth: 88, minHeight: 44, whiteSpace: 'normal', overflowWrap: 'anywhere' };

/** The planet as it stands, fitted to its land, drawn by the same painter as Change Planet. */
function PlanetShot({ style }: { style: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const state = useEditorStore.getState().gridState;
    if (ref.current && state) paintPlanet(ref.current, { state, template: state.template }, { tx: 0, ty: 0, scale: 1 }, { margin: SHOT_MARGIN });
  }, [style.width, style.height]);
  return (
    <canvas ref={ref} aria-hidden style={{
      display: 'block', borderRadius: radii.md, background: ZONE_COLORS[CellZone.Void],
      border: `1.5px solid ${skin.line}`, boxSizing: 'border-box', ...style,
    }} />
  );
}
