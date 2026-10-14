/**
 * The planet session's nameplate: Back, the planet's name and Done on one plate on the mode row's ink line,
 * centred while the span allows, then sliding, then the name giving up width. The toast band moves below
 * it (`nameplate-layout.ts:toastBandShift`). Back asks before discarding drawn work; Done waits for ground and grows the save
 * panel, which a press on the name opens at its field.
 */
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { type GridState } from '../../../core/model/types';
import { joinList } from '../../../i18n/locale-info';
import { showToast } from '../../../platform/channels/toast-bus';
import { localizedName, quantityParams, useLocale, useT } from '../../../i18n/context';
import { getCatalogItem } from '../../../state/catalog';
import { pendingLandmarks, sessionFrame, sessionHasEdits, sessionHasGround } from '../../../editor/operations/planet-session';
import { useEditorStore } from '../../../state/store';
import { touchFloorZoom, useChromeScale, useDenseScript, useDevicePixelRatio, useTouchPrimary, useViewportSize } from '../../design/scale';
import { TOAST_BAND_SHIFT_VAR } from '../../chrome/floating/toast-band';
import { ShapeEdge, isWebKitEngine } from '../../design/shape-edge';
import { btnReset, font, radii, z } from '../../design/styles';
import { roleFont, weightVars } from '../../design/text-weight';
import { INK, LINE, PLATE, PLATE_INK, SEA } from '../../design/tokens';
import { cozyPanel, skin, windowCard } from '../../design/window-skin';
import { ActionButton } from '../../primitives/ActionButton';
import { Switch } from '../../primitives/Switch';
import { AnchoredConfirm, anchoredCardMotion, anchoredOrigin } from '../../primitives/AnchoredConfirm';
import { useFloatingPosition } from '../../primitives/use-floating-position';
import { BackIcon, CheckIcon, EditIcon } from '../../primitives/line-glyphs';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { paintPlanet } from '../../../view/map2d/capture/planet-painter';
import { useSurfaceScope } from '../../primitives/surface-scope';
import { PlanetNameField, usePlanetNameReview } from '../../chrome/modals/planet/PlanetNameField';
import { sessionModes, TOP_RIGHT_TOP } from '../frame';
import { useFrameLayout } from '../frame-layout';
import { EDGE_RIGHT } from '../units';
import { useFrameZoom } from '../use-frame-zoom';
import { finishPlanetEditing, stopPlanetEditing } from '../../../editor/session/planet-editing';
import { useSessionPlanetName } from './use-planet-session';
import { useCanvasFact } from '../../session/use-canvas-fact';
import { useRootCssVars } from '../../primitives/use-root-css-vars';
import { NAME_GAP, NAME_LEAST, NAME_PAD, PANEL_GAP, PEN, PLATE_ROW, nameplateSpan, nameplateTop, toastBandShift } from './nameplate-layout';

/** Each control on the plate and in its panel, in css px. */
const BUTTON = 44;
/** Inset of the controls from the plate's ends, and the space between them, in css px. */
const PLATE_PAD = 4;
const PLATE_GAP = 4;
/** The rule between Back and the name: inset from the plate's top and bottom, and its side air. */
const RULE_INSET = 12;
const RULE_AIR = 2;
const NAME_MAX_W = 220;
const TICK = 18;
const DONE_PAD = { start: 14, end: 18 };
const DONE_GAP = 6;
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

/** Whether leaving would lose work (`sessionHasEdits`). */
const hasEdits = (): boolean => {
  const s = useEditorStore.getState();
  return sessionHasEdits(s.planetSession, s.commandExecutor?.historyDepth() ?? 0);
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

  useRootCssVars({ [TOAST_BAND_SHIFT_VAR]: `${shift}px` });

  const back = () => {
    if (asking === 'discard') { close(); return; }
    if (hasEdits()) setAsking('discard');
    else stopPlanetEditing();
  };
  const rename = () => { setAsking('save'); setNameAsk((n) => n + 1); };
  const save = (asCopy: boolean) => {
    const trimmed = name.trim();
    if (!trimmed || !ground) return;
    const result = finishPlanetEditing(trimmed, asCopy, fallback);
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
            <ActionButton ref={backRef} data-testid="planet-back" interaction="tile"
              aria-label={t('planet.back')} title={t('planet.back')} onClick={back} style={iconButton}>
              <BackIcon />
            </ActionButton>
            <PlateRule />
            <ActionButton data-testid="planet-name" interaction="pill"
              aria-label={t('planet.rename_named', { name: shown })} aria-expanded={asking === 'save'} onClick={rename} title={shown}
              style={{ ...btnReset, display: 'flex', alignItems: 'center', gap: NAME_GAP, height: BUTTON, padding: `0 ${NAME_PAD}px`, borderRadius: radii.pill, color: PLATE_INK, flex: '0 1 auto', minWidth: NAME_LEAST }}>
              <span style={{ ...roleFont('head'), minWidth: 0, maxWidth: NAME_MAX_W, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shown}</span>
              <span aria-hidden style={{ display: 'flex', color: skin.muted, flex: 'none' }}><EditIcon size={PEN} /></span>
            </ActionButton>
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

/** `pendingLandmarks` of the live session, as their ids joined by spaces, so a reading compares by value. */
function pendingIds(state: GridState | null): string {
  return pendingLandmarks(useEditorStore.getState().planetSession, state).join(' ');
}

/** A scanned planet's segment of the plate: how many places to check, the inferred landmark and each
 *  landmark still to place counted as one, and the switch that shows them on the map. Its title spells
 *  the count out. */
function ReviewSegment({ cells, landmark }: { cells: number; landmark: boolean }) {
  const t = useT();
  const locale = useLocale();
  const pending = useCanvasFact(pendingIds).split(' ').filter(Boolean);
  const shown = useEditorStore((s) => s.planetReviewShown);
  const setShown = useEditorStore((s) => s.setPlanetReviewShown);
  const key = landmark ? 'planet.review_count_landmark' : 'planet.review_count';
  const counted = t(key, quantityParams(locale, { n: cells }));
  const names = pending.map((id) => { const item = getCatalogItem(id); return item ? localizedName(item.name, locale) : id; });
  const full = names.length ? t('planet.review_with_unplaced', { review: counted, name: joinList(locale, names) }) : counted;
  return (
    <div data-testid="planet-review" title={full} style={{
      display: 'flex', alignItems: 'center', gap: REVIEW_GAP, height: BUTTON, flex: 'none', whiteSpace: 'nowrap',
      paddingInline: `${REVIEW_PAD.start}px ${REVIEW_PAD.end}px`,
    }}>
      <span data-testid="planet-review-count" style={{ ...roleFont('label'), color: PLATE_INK }}>
        {t('planet.review_short', quantityParams(locale, { n: cells + (landmark ? 1 : 0) + pending.length }))}
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
      display: 'block', borderRadius: radii.md, background: SEA,
      border: `1.5px solid ${skin.line}`, boxSizing: 'border-box', ...style,
    }} />
  );
}
