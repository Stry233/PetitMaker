import { useState, useRef, useEffect, type CSSProperties, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { font, colors, inkTint, springs, radii, buttonMotion, cursors } from '../../design/styles';
import { skin, windowCard, windowPill, windowPrimary, windowTitle } from '../../design/window-skin';
import { roleFont } from '../../design/text-weight';
import { BUILD_NUMBER, brandName } from '../../../version';
import type { Locale } from '../../../core/model/types';
import { ELEVATION_COLORS, WATER_COLOR, ZONE_COLORS } from '../../../core/model/constants';
import { cursorArt } from '../../../assets/cursors/cursor-art';
import { iconUrl } from '../../../assets/icon-urls';
import { ModalShell } from '../../primitives/ModalShell';
import { resetAllLocalData } from '../../../io/local-reset';
import { Spinner } from '../../primitives/Spinner';
import { useEditorStore } from '../../../state/store';
import { startTour } from '../tour/use-tour';

// UI-scale slider bounds — mirror the Ctrl+(+/−) shortcut exactly: the store's
// setUiZoom clamps to [0.6, 1.8] and the shortcut bumps by 0.1, so this slider
// shares the same clamps/step (there is only ONE persistence path — setUiZoom).
const UI_SCALE_MIN = 0.6;
const UI_SCALE_MAX = 1.8;
const UI_SCALE_STEP = 0.1;
const roundStep = (z: number) => Math.round(z / UI_SCALE_STEP) * UI_SCALE_STEP;

/* ── the mini-map every picture tile draws ─────────────────────────────────
 * A 10×7-cell postage stamp of a map in the real palette (zone + elevation
 * constants), so the toggles and the quality trio show their effect on the
 * thing itself rather than naming it. One drawing shared by all five tiles:
 * a pond with a sand rim, a stepped mountain, the plaza, the rest grass. */
const MAP_CELL = 12;
const MAP_W = 10 * MAP_CELL;
const MAP_H = 7 * MAP_CELL;
const GRASS = ZONE_COLORS[2]!;
const SEA = WATER_COLOR;
const SAND = ZONE_COLORS[1]!;
const PLAZA = ZONE_COLORS[3]!;
const POND: Array<[number, number]> = [[0, 4], [1, 4], [0, 5], [1, 5], [2, 5], [0, 6], [1, 6], [2, 6]];
const RIM: Array<[number, number]> = [[0, 3], [1, 3], [2, 3], [2, 4], [3, 4], [3, 5], [3, 6]];
const MOUNT_1: Array<[number, number]> = [[6, 0], [7, 0], [8, 0], [9, 0], [6, 1], [7, 1], [8, 1], [9, 1], [7, 2], [8, 2], [9, 2]];
const MOUNT_2: Array<[number, number]> = [[7, 0], [8, 0], [9, 0], [8, 1], [9, 1]];
const MOUNT_3: Array<[number, number]> = [[9, 0], [9, 1]];
const PLAZA_CELLS: Array<[number, number]> = [[4, 2], [5, 2], [4, 3], [5, 3]];

function cells(at: Array<[number, number]>, fill: string): ReactNode {
  return at.map(([x, y]) => (
    <rect key={`${x}-${y}`} x={x * MAP_CELL} y={y * MAP_CELL} width={MAP_CELL} height={MAP_CELL} fill={fill} />
  ));
}

function MapBase(): ReactNode {
  return (
    <>
      <rect width={MAP_W} height={MAP_H} fill={GRASS} />
      {cells(POND, SEA)}
      {cells(RIM, SAND)}
      {cells(MOUNT_1, ELEVATION_COLORS[1]!)}
      {cells(MOUNT_2, ELEVATION_COLORS[2]!)}
      {cells(MOUNT_3, ELEVATION_COLORS[3]!)}
      {cells(PLAZA_CELLS, PLAZA)}
    </>
  );
}

/** The overlays the two toggles show. Grid lines are white like the canvas's own (alpha raised —
 *  the canvas's 0.14 vanishes at stamp scale); chunk bounds are the renderer's black at 0.35. */
function MapOverlay({ kind, on }: { kind: 'grid' | 'chunks'; on: boolean }): ReactNode {
  const style: CSSProperties = { opacity: on ? 1 : 0, transition: 'opacity 0.18s ease' };
  if (kind === 'grid') {
    return (
      <g style={style} stroke="rgba(255,255,255,0.65)" strokeWidth={1}>
        {Array.from({ length: 9 }, (_, i) => <line key={`v${i}`} x1={(i + 1) * MAP_CELL} y1={0} x2={(i + 1) * MAP_CELL} y2={MAP_H} />)}
        {Array.from({ length: 6 }, (_, i) => <line key={`h${i}`} x1={0} y1={(i + 1) * MAP_CELL} x2={MAP_W} y2={(i + 1) * MAP_CELL} />)}
      </g>
    );
  }
  return (
    <g style={style} stroke="rgba(0,0,0,0.35)" strokeWidth={2}>
      <line x1={5 * MAP_CELL} y1={0} x2={5 * MAP_CELL} y2={MAP_H} />
      <line x1={0} y1={3.5 * MAP_CELL} x2={MAP_W} y2={3.5 * MAP_CELL} />
    </g>
  );
}

/* The quality tiles are photographs, not drawings: the SAME corner of an island captured from the
 * app's own 3D view at each pinned profile — full carries the extra sampling and render scale,
 * lite the blocky 1x it trades them for. 'auto' shows half of each with a seam, since its meaning
 * is "whichever this device earns". */
const QUALITY_FULL_URL = iconUrl('settings-quality-full');
const QUALITY_LITE_URL = iconUrl('settings-quality-lite');

const qualityImg = (clip?: 'left' | 'right'): CSSProperties => ({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  ...(clip ? { clipPath: clip === 'left' ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)' } : {}),
});

function QualityShot({ q }: { q: 'auto' | 'full' | 'lite' }): ReactNode {
  if (q === 'full') return <img src={QUALITY_FULL_URL} alt="" style={qualityImg()} />;
  if (q === 'lite') return <img src={QUALITY_LITE_URL} alt="" style={qualityImg()} />;
  return (
    <>
      <img src={QUALITY_LITE_URL} alt="" style={qualityImg('left')} />
      <img src={QUALITY_FULL_URL} alt="" style={qualityImg('right')} />
      <span style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 0, borderLeft: `1.5px dashed ${inkTint(0.45)}` }} />
    </>
  );
}

/* ── tile chrome shared by the toggles and the quality trio ───────────── */

const picStyle = (on: boolean): CSSProperties => ({
  display: 'block',
  width: '100%',
  aspectRatio: '4 / 3',
  borderRadius: radii.md,
  overflow: 'hidden',
  background: GRASS,
  boxShadow: on
    ? `inset 0 0 0 1px ${inkTint(0.12)}, 0 0 0 3px ${skin.active}`
    : `inset 0 0 0 1px ${inkTint(0.12)}`,
  transition: 'box-shadow 0.15s ease',
});

const tileStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: cursors.clickable,
};

const capStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  ...roleFont('chip'),
  fontFamily: font.family,
  color: skin.plateInk,
};

const capDot = (on: boolean): CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: radii.pill,
  background: on ? skin.active : skin.track,
  transition: 'background-color 0.15s ease',
});

function MapTile({ kind, on, label, onToggle }: { kind: 'grid' | 'chunks'; on: boolean; label: string; onToggle: () => void }) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      style={tileStyle}
      onClick={onToggle}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={springs.stiff}
    >
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="none" style={picStyle(on)} aria-hidden>
        <MapBase />
        <MapOverlay kind={kind} on={on} />
      </svg>
      <span style={capStyle}><span style={capDot(on)} />{label}</span>
    </motion.button>
  );
}

/* ── the interface group's steps (motion) and choices (cursor) ─────────── */

const stepStyle = (on: boolean): CSSProperties => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  padding: '10px 4px 8px',
  borderRadius: radii.md,
  border: 'none',
  background: on ? skin.active : skin.plate,
  boxShadow: on ? 'none' : `inset 0 0 0 1px ${inkTint(0.10)}`,
  cursor: cursors.clickable,
  transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
});

const stepName: CSSProperties = { ...roleFont('chip'), fontFamily: font.family, color: skin.plateInk };

type MotionPref = 'system' | 'reduced' | 'full';

/** The demo pinwheel: the plain "motion" mark, nothing a visitor could misread as map content. */
const PINWHEEL = (
  // display: block, or the inline svg sits on the text baseline and its wrapper keeps descender
  // room under it — the rotation origin (50% of the wrapper) then lands below the hub, and the
  // wheel orbits that point instead of spinning on its own centre (measured: 1.75px low).
  <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden style={{ display: 'block' }}>
    <g fill={skin.ink}>
      <path d="M12 12 L12 2 A10 10 0 0 1 19 5 Z" />
      <path d="M12 12 L22 12 A10 10 0 0 1 19 19 Z" />
      <path d="M12 12 L12 22 A10 10 0 0 1 5 19 Z" />
      <path d="M12 12 L2 12 A10 10 0 0 1 5 5 Z" />
    </g>
    <circle cx="12" cy="12" r="2.6" fill={skin.active} />
  </svg>
);

/** The small monitor the System tile wears: the mark that says the DEVICE made this choice. */
const DEVICE_BADGE = (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden style={{ position: 'absolute', right: -12, bottom: -2 }}>
    <rect x="1" y="1.5" width="13" height="9.5" rx="2" fill={skin.plate} stroke={skin.muted} strokeWidth="1.7" />
    <rect x="4.5" y="12.4" width="6" height="1.8" rx="0.9" fill={skin.muted} />
  </svg>
);

/** Whether THIS device asks for reduced motion — what the System choice resolves to, so its demo
 *  shows the answer rather than a symbol for the question. Read per render: cheap, and a toggle
 *  of the OS setting while the panel is open is then honoured. */
function deviceReduces(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Each option performs itself: Full's pinwheel spins, Reduced's stands still, and System's does
 * whichever this device asks for while wearing the device badge that says who decided. Framer
 * drives the spin, so App's MotionConfig stops it under an actual reduced-motion state.
 */
function MotionDemo({ pref }: { pref: MotionPref }) {
  const spins = pref === 'full' || (pref === 'system' && !deviceReduces());
  return (
    <span style={{ height: 30, display: 'grid', placeItems: 'center' }} aria-hidden>
      <span style={{ position: 'relative', display: 'block' }}>
        <motion.span
          style={{ display: 'block' }}
          animate={spins ? { rotate: 360 } : { rotate: 0 }}
          transition={spins ? { duration: 2.2, ease: 'linear', repeat: Infinity } : { duration: 0 }}
        >
          {PINWHEEL}
        </motion.span>
        {pref === 'system' && DEVICE_BADGE}
      </span>
    </span>
  );
}

const choiceStyle = (on: boolean): CSSProperties => ({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '9px 12px',
  borderRadius: radii.md,
  border: 'none',
  background: on ? skin.active : skin.plate,
  boxShadow: on ? 'none' : `inset 0 0 0 1px ${inkTint(0.10)}`,
  cursor: cursors.clickable,
  transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
  ...roleFont('chip'),
  fontFamily: font.family,
  color: skin.plateInk,
});

/** The OS arrow, drawn — a CSS `cursor` keyword cannot be shown as an image, so the choice shows
 *  a generic arrow silhouette next to the app's real painted art. */
const SYSTEM_ARROW = (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
    <path d="M6 3 L6 17.5 L9.8 14.4 L12.2 20 L14.9 18.8 L12.5 13.4 L17.5 13 Z" fill={colors.white} stroke={colors.frameDark} strokeWidth={1.4} strokeLinejoin="round" />
  </svg>
);

const PAINTED_ARROW_URL = cursorArt('default');

/* ── UI-scale slider ────────────────────────────────────────────────────
 * A ticked track flanked by a small and a large A, with a live "Aa" specimen
 * beside it and a ↺ chip that appears off-default without moving anything.
 *
 * APPLY-ON-RELEASE (pointer): dragging only moves LOCAL visual state (`dragZoom`
 * → knob / fill / bubble / specimen); the store's setUiZoom fires ONLY on pointer
 * release (pointerup / lostpointercapture / cancel). This kills the mid-drag
 * re-zoom feedback loop: committing uiZoom while dragging re-applies the chrome
 * CSS `zoom`, which rescales the slider under the cursor and makes the drag jump.
 * KEYBOARD applies IMMEDIATELY per key press: steps are discrete (0.1) and each
 * press is a deliberate commit, so there is no continuous feedback loop to break;
 * applying at once keeps aria-valuenow and the reset chip in lockstep with the
 * key. Double-click reset + the ↺ chip also apply immediately. */
function UiScaleSlider({ label }: { label: string }) {
  const uiZoom = useEditorStore((s) => s.uiZoom);
  const setUiZoom = useEditorStore((s) => s.setUiZoom);
  const ref = useRef<HTMLDivElement>(null);
  // While dragging, `dragZoom` holds the un-committed value; null otherwise. `dragRef`
  // mirrors it so `commitDrag` can read the pending value without a stale closure and
  // without calling setUiZoom from inside a setState updater.
  const [dragZoom, setDragZoom] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const [hover, setHover] = useState(false);
  const dragging = dragZoom !== null;
  const setDrag = (v: number) => { dragRef.current = v; setDragZoom(v); };
  // What the knob/fill/bubble/specimen show — the live drag value while dragging, else the store value.
  const shownZoom = dragZoom ?? uiZoom;
  const pct = Math.round(shownZoom * 100);
  const ratio = (shownZoom - UI_SCALE_MIN) / (UI_SCALE_MAX - UI_SCALE_MIN);
  const isDefault = Math.round(uiZoom * 100) === 100;

  const zoomFromClientX = (clientX: number): number => {
    const el = ref.current;
    if (!el) return uiZoom;
    const r = el.getBoundingClientRect();
    const frac = r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
    return roundStep(UI_SCALE_MIN + frac * (UI_SCALE_MAX - UI_SCALE_MIN));
  };
  // Commit the pending drag value to the store on release (idempotent — a no-op if not dragging).
  const commitDrag = () => {
    if (dragRef.current !== null) setUiZoom(dragRef.current);
    dragRef.current = null;
    setDragZoom(null);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = uiZoom + UI_SCALE_STEP;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = uiZoom - UI_SCALE_STEP;
    else if (e.key === 'Home') next = UI_SCALE_MIN;
    else if (e.key === 'End') next = UI_SCALE_MAX;
    if (next !== null) { e.preventDefault(); setUiZoom(roundStep(next)); }
  };

  // The flanking A marks are the ladder's own ends: the smallest rank on one side of the track,
  // the title rank on the other, so the sizes come from the inventory like any run of text.
  const flankA = (role: 'caption' | 'title'): CSSProperties => ({
    ...roleFont(role),
    fontFamily: font.family,
    color: skin.muted,
    lineHeight: 1,
    flexShrink: 0,
  });

  const tickCount = Math.round((UI_SCALE_MAX - UI_SCALE_MIN) / UI_SCALE_STEP) + 1;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={flankA('caption')} aria-hidden>A</span>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={Math.round(UI_SCALE_MIN * 100)}
        aria-valuemax={Math.round(UI_SCALE_MAX * 100)}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%`}
        onKeyDown={onKeyDown}
        onDoubleClick={() => { dragRef.current = null; setDragZoom(null); setUiZoom(1); }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag(zoomFromClientX(e.clientX)); }}
        onPointerMove={(e) => { if (e.buttons) setDrag(zoomFromClientX(e.clientX)); }}
        onPointerUp={commitDrag}
        onPointerCancel={commitDrag}
        onLostPointerCapture={commitDrag}
        style={{ position: 'relative', flex: 1, height: 34, cursor: cursors.clickable, touchAction: 'none', outline: 'none' }}
      >
        <div style={{ position: 'absolute', top: 8, left: 0, right: 0, height: 10, background: skin.track, borderRadius: radii.pill }} />
        <div style={{ position: 'absolute', top: 8, left: 0, width: `${ratio * 100}%`, height: 10, background: skin.active, borderRadius: radii.pill }} />
        {Array.from({ length: tickCount }, (_, i) => {
          const v = UI_SCALE_MIN + i * UI_SCALE_STEP;
          const mid = Math.round(v * 100) === 100;
          return (
            <span
              key={i}
              style={{
                position: 'absolute',
                top: 22,
                left: `${(i / (tickCount - 1)) * 100}%`,
                width: 1.5,
                height: mid ? 8 : 5,
                background: mid ? skin.muted : skin.track,
                opacity: mid ? 0.55 : 1,
                transform: 'translateX(-50%)',
              }}
            />
          );
        })}
        <div style={{ position: 'absolute', top: 13, left: `${ratio * 100}%`, width: 20, height: 20, transform: 'translate(-50%, -50%)', borderRadius: '50%', background: skin.active, boxShadow: `0 2px 6px ${inkTint(0.3)}` }} />
        {/* Value bubble over the knob: dark fill, white bold %, soft shadow, down-pointing tail.
            Framer x:'-50%' centering, NEVER a CSS transform on the animated element — framer owns
            the transform. Shows on hover OR drag. */}
        <AnimatePresence>
          {(hover || dragging) && (
            <motion.div key="bubble"
              initial={{ opacity: 0, scale: 0.6, x: '-50%', y: 4 }}
              animate={{ opacity: 1, scale: 1, x: '-50%', y: 0 }}
              exit={{ opacity: 0, scale: 0.6, x: '-50%', y: 4 }}
              transition={springs.stiff}
              style={{ position: 'absolute', left: `${ratio * 100}%`, bottom: '100%', marginBottom: 8, transformOrigin: 'bottom center', background: skin.ink, color: skin.onDark, fontFamily: font.family, ...roleFont('menu'), lineHeight: 1, padding: '5px 11px', borderRadius: 10, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: `0 4px 12px ${inkTint(0.32)}` }}>
              {`${pct}%`}
              <span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: `6px solid ${skin.ink}` }} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <span style={flankA('title')} aria-hidden>A</span>
      {/* The live specimen: the letters scale as the interface would. */}
      <div style={{ width: 50, height: 50, borderRadius: radii.md, background: skin.plate, boxShadow: `inset 0 0 0 1px ${inkTint(0.10)}`, display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }} aria-hidden>
        <span style={{ ...roleFont('label'), fontFamily: font.family, color: skin.ink, transition: 'transform 0.15s ease', transform: `scale(${shownZoom})` }}>Aa</span>
      </div>
      {/* ↺ keeps its slot when hidden so appearing never shifts the row; aria-hidden takes it out
          of the accessibility tree at 100%, where there is nothing to reset. */}
      <motion.button
        type="button"
        aria-label={`${label} 100%`}
        aria-hidden={isDefault}
        tabIndex={isDefault ? -1 : 0}
        style={{
          width: 32, height: 32, borderRadius: radii.pill, border: 'none',
          background: skin.inset, color: skin.plateInk, fontFamily: font.family,
          ...roleFont('chip'), display: 'grid', placeItems: 'center', flexShrink: 0,
          cursor: cursors.clickable,
          opacity: isDefault ? 0 : 1, pointerEvents: isDefault ? 'none' : 'auto',
          transition: 'opacity 0.15s ease',
        }}
        onClick={() => setUiZoom(1)}
        whileTap={{ scale: 0.9 }}
        whileHover={{ scale: 1.08 }}
      >
        {'↺'}
      </motion.button>
    </div>
  );
}

// Language pills — native endonyms so each is recognizable in its own script,
// all seven visible at once. Order matches the translation source spreadsheet
// (zh first).
const LOCALES: { code: Locale; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ru', label: 'Русский' },
  { code: 'th', label: 'ไทย' },
  { code: 'id', label: 'Indonesia' },
  { code: 'fr', label: 'Français' },
];

export interface SettingsModalProps {
  /** Drives the shared `ModalShell` open/close choreography. Defaults to `true`
   *  so tests can mount the modal directly; App passes `open={showSettings}`
   *  and keeps the component mounted so the card exit animates as one unit. */
  open?: boolean;
  locale: Locale;
  showGrid: boolean;
  showChunks: boolean;
  motionPref: MotionPref;
  systemCursors: boolean;
  quality3d: 'auto' | 'full' | 'lite';
  onLocaleChange: (locale: Locale) => void;
  onShowGridChange: (show: boolean) => void;
  onShowChunksChange: (show: boolean) => void;
  onMotionPrefChange: (p: MotionPref) => void;
  onSystemCursorsChange: (on: boolean) => void;
  onQuality3dChange: (q: 'auto' | 'full' | 'lite') => void;
  onAbout: () => void;
  onClose: () => void;
}

const CARD_ROW_GAP = 22;

// A landscape phone (390-412 css px tall) is shorter than this card's content needs at
// FIT_FLOOR, and `cozyOverlay` centres the card with no page scroll of its own — so without a
// cap the card clips top and bottom alike and the Done button goes unreachable. `maxVh` on
// the `ModalShell` call below bounds the card; the scroll here is what makes everything past
// that bound still reachable.
const cardStyle: CSSProperties = {
  ...windowCard,
  padding: '26px 26px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: CARD_ROW_GAP,
  overflowY: 'auto',
  overflowX: 'hidden',
};

/** The erase-confirm dialog's card: the same plate at the compact size a single question needs. */
const confirmCardStyle: CSSProperties = {
  ...windowCard,
  padding: '22px 22px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const titleStyle: CSSProperties = { ...windowTitle };

const langBandStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  justifyContent: 'center',
};

const langPill = (on: boolean): CSSProperties => ({
  ...windowPill(on ? 'active' : 'quiet'),
});

// The two groups: what the map shows (and how it renders), and how the interface feels. The
// grouping is the panel's only structure — no headers, each control self-describes.
const bodyStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '272px 1fr',
  gap: 14,
  alignItems: 'stretch',
};

const groupStyle: CSSProperties = {
  background: 'rgba(234, 232, 205, 0.42)',
  borderRadius: 18,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  justifyContent: 'space-between',
};

const rowOfTiles: CSSProperties = { display: 'flex', gap: 12 };

// The meta strip: what the app is (drills into About), what it can replay, what it can forget.
const metaStyle: CSSProperties = { display: 'flex', gap: 10, alignItems: 'stretch' };

const readoutStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: skin.inset,
  border: 'none',
  borderRadius: 14,
  padding: '10px 16px',
  textAlign: 'left',
  cursor: cursors.clickable,
  fontFamily: font.family,
};

const metaPillStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: skin.inset,
  border: 'none',
  borderRadius: 14,
  padding: '10px 16px',
  whiteSpace: 'nowrap',
  cursor: cursors.clickable,
  ...roleFont('chip'),
  fontFamily: font.family,
  color: skin.plateInk,
};

const dangerPillStyle: CSSProperties = {
  ...metaPillStyle,
  background: colors.dangerBg,
  color: colors.dangerText,
};

const aboutChipStyle: CSSProperties = { ...windowPill() };

const dangerConfirmStyle: CSSProperties = {
  ...windowPill('danger'),
  background: colors.statusError,
  color: colors.white,
};

export function SettingsModal({
  open = true,
  locale,
  showGrid,
  showChunks,
  motionPref,
  systemCursors,
  quality3d,
  onLocaleChange,
  onShowGridChange,
  onShowChunksChange,
  onMotionPrefChange,
  onSystemCursorsChange,
  onQuality3dChange,
  onAbout,
  onClose,
}: SettingsModalProps) {
  const t = useT();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Fresh start each time the modal opens: the component stays mounted between
  // opens, so the reset-confirm flow resets here rather than on unmount.
  useEffect(() => {
    if (open) {
      setConfirmReset(false);
      setResetting(false);
    }
  }, [open]);

  const qualityOptions = ['auto', 'full', 'lite'] as const;
  const motionOptions: MotionPref[] = ['reduced', 'system', 'full'];

  return (
    <>
    <ModalShell open={open} onClose={onClose} width={620} maxVh={92} maxVw={94} cardStyle={cardStyle} ariaLabel={t('modal.settings_title')}>
      <div style={titleStyle}>{t('modal.settings_title')}</div>

      {/* Language — all seven endonyms visible at once; each names itself in its own script. */}
      <div style={langBandStyle} role="radiogroup" aria-label={t('modal.settings_language')}>
        {LOCALES.map(({ code, label }) => (
          <motion.button
            key={code}
            type="button"
            role="radio"
            aria-checked={locale === code}
            style={langPill(locale === code)}
            onClick={() => onLocaleChange(code)}
            whileTap={{ scale: 0.95 }}
            whileHover={{ scale: 1.05 }}
          >
            {label}
          </motion.button>
        ))}
      </div>

      <div style={bodyStyle}>
        {/* The map: what shows on it, and how it renders. */}
        <div style={groupStyle}>
          <div style={rowOfTiles}>
            <MapTile kind="grid" on={showGrid} label={t('modal.settings_grid')} onToggle={() => onShowGridChange(!showGrid)} />
            <MapTile kind="chunks" on={showChunks} label={t('modal.settings_chunks')} onToggle={() => onShowChunksChange(!showChunks)} />
          </div>
          {/* Graphics quality — governs the 3D scene AND the 2D canvas's render-scale cap on a
              software rasterizer (device-quality.ts:maxRenderScale reads this pref). Auto follows
              the GL probe; Full and Lite pin the choice, for a misread GPU or a screenshot worth
              the wait. Shown as the same map at each quality. */}
          <div style={rowOfTiles} role="radiogroup" aria-label={t('modal.settings_quality3d')}>
            {qualityOptions.map((q) => (
              <motion.button
                key={q}
                type="button"
                role="radio"
                aria-checked={quality3d === q}
                style={tileStyle}
                onClick={() => onQuality3dChange(q)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                transition={springs.stiff}
              >
                <span style={{ ...picStyle(quality3d === q), position: 'relative' }} aria-hidden>
                  <QualityShot q={q} />
                </span>
                <span style={capStyle}>{t(`modal.settings_quality3d_${q}`)}</span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* The interface: its size, its motion, its pointer. */}
        <div style={groupStyle}>
          <UiScaleSlider label={t('modal.settings_ui_scale')} />
          {/* Motion preference — System follows the OS reduce-motion setting; the others
              override it. Each step's ball performs the choice. */}
          <div style={{ display: 'flex', gap: 10 }} role="radiogroup" aria-label={t('modal.settings_motion')}>
            {motionOptions.map((p) => (
              <motion.button
                key={p}
                type="button"
                role="radio"
                aria-checked={motionPref === p}
                style={stepStyle(motionPref === p)}
                onClick={() => onMotionPrefChange(p)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                transition={springs.stiff}
              >
                <MotionDemo pref={p} />
                <span style={stepName}>{t(`modal.settings_motion_${p}`)}</span>
              </motion.button>
            ))}
          </div>
          {/* Cursor — the accessibility opt-out. A custom CSS cursor is an image, so it cannot
              honour the pointer size or theme the OS is configured with; a user who relies on
              those needs a way back. The choice shows the two arrows themselves. */}
          <div style={{ display: 'flex', gap: 10 }} role="radiogroup" aria-label={t('modal.settings_cursor')}>
            <motion.button
              type="button"
              role="radio"
              aria-checked={!systemCursors}
              style={choiceStyle(!systemCursors)}
              onClick={() => onSystemCursorsChange(false)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              transition={springs.stiff}
            >
              {PAINTED_ARROW_URL ? <img src={PAINTED_ARROW_URL} alt="" width={24} height={24} /> : null}
              {t('modal.settings_cursor_painted')}
            </motion.button>
            <motion.button
              type="button"
              role="radio"
              aria-checked={systemCursors}
              style={choiceStyle(systemCursors)}
              onClick={() => onSystemCursorsChange(true)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              transition={springs.stiff}
            >
              {SYSTEM_ARROW}
              {t('modal.settings_cursor_system')}
            </motion.button>
          </div>
        </div>
      </div>

      <div style={metaStyle}>
        {/* Identity readout — the app and its build, drilling into About. */}
        <motion.button type="button" style={readoutStyle} onClick={onAbout} whileTap={{ scale: 0.985 }} whileHover={{ scale: 1.01 }} aria-label={t('modal.settings_about')}>
          <span style={{ ...roleFont('label'), fontFamily: font.family, color: skin.ink }}>{brandName(locale)}</span>
          <span style={{ ...roleFont('chip'), fontFamily: font.family, color: skin.muted }}>{`${t('about.build')} ${BUILD_NUMBER}`}</span>
          <span style={{ marginLeft: 'auto', color: skin.muted, ...roleFont('chip'), fontFamily: font.family }}>{'›'}</span>
        </motion.button>

        {/* Replay the first-launch tour. A button, not a toggle: it performs an action rather
            than holding a setting. Closes Settings before starting the tour so the modal does
            not sit on top of the overlay it just launched. */}
        <motion.button type="button" style={metaPillStyle} onClick={() => { onClose(); startTour(); }} whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.03 }}>
          {t('modal.settings_tour')}
        </motion.button>

        {/* Reset local data — asks in its own dialog below, so the pill stands whatever the
            answer and the card never changes shape under it. */}
        <motion.button type="button" style={dangerPillStyle} onClick={() => setConfirmReset(true)} whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.03 }}>
          {t('modal.settings_reset_btn')}
        </motion.button>
      </div>

      <motion.button style={windowPrimary} onClick={onClose} {...buttonMotion}>
        {t('modal.settings_ok')}
      </motion.button>
    </ModalShell>

    {/* The erase confirm: a small dialog over the dimmed panel, the same shell every modal is
        made of. A SIBLING of the settings shell, never a child of its card — the card carries
        the chrome-scale CSS zoom, which scales a nested fixed overlay a second time. Mounted
        after it, so it paints above at their shared rung, and ModalShell's Escape stack makes
        one press close only this. While `resetting` the wipe is in flight and reload is the
        only exit, so the dialog stops offering one (onClose is a no-op). */}
    <ModalShell
      open={open && confirmReset}
      onClose={() => { if (!resetting) setConfirmReset(false); }}
      width={380}
      maxVw={94}
      cardStyle={confirmCardStyle}
      ariaLabel={t('modal.settings_reset_title')}
    >
      <div style={{ ...windowTitle, color: colors.dangerDeep }}>{t('modal.settings_reset_title')}</div>
      <span style={{ ...roleFont('label'), fontFamily: font.family, color: colors.dangerDeep, lineHeight: 1.45, background: colors.dangerBg, borderRadius: radii.lg, padding: '14px 16px' }}>
        {t('modal.settings_reset_warn')}
      </span>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
        {resetting ? (
          <Spinner size={22} color={colors.statusError} />
        ) : (
          <>
            <motion.button style={aboutChipStyle} onClick={() => setConfirmReset(false)} {...buttonMotion}>
              {t('delete.cancel')}
            </motion.button>
            <motion.button
              style={dangerConfirmStyle}
              onClick={() => { setResetting(true); void resetAllLocalData(); }}
              {...buttonMotion}
            >
              {t('modal.settings_reset_confirm')}
            </motion.button>
          </>
        )}
      </div>
    </ModalShell>
    </>
  );
}
