/**
 * atoms.tsx — shared visual atoms for the agent "Site Log" UI (spec §UI.2/UI.4,
 * normative prototype: docs/internal/superpowers/specs/
 * 2026-07-16-agent-v2-sitelog-prototype.html). Every geometry value is the
 * prototype's css px × 2 (design px, spec §UI.0) passed through usePx().
 *
 * Looping CSS decor (wave travel, stripes, watermark draw) lives in
 * ui/animations.css as .pw-* classes with --pw-* custom properties carrying
 * the scale-dependent geometry; discrete motion is Framer Motion, gated on
 * useReducedMotionConfig like the rest of the menu UI.
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useAnimationFrame, useMotionValue, useTransform, useReducedMotionConfig } from 'framer-motion';
import type { Tick, VerbIcon } from '../../../agent/session';
import { useT } from '../../../i18n/context';
import { colors as C, inkTint, font, springs, exitTransition, cursors } from '../../styles';
import { usePx } from '../scale';
import { Markdown } from './Markdown';

/* ── palette constants (prototype :root tokens without a styles.ts twin) ── */

export const OK_GREEN = '#4CA42A';
export const RUN_GREY = '#8B8678';
export const REVERT_AMBER = '#E0A32E';
export const FIELD_DEEP = '#E8E1D2';
export const CARD_LINE = '#eee2cf';
export const REVERT_TEXT = '#b07d17';
export const VITAL_GREEN = '#3a9d6b';

/** Inline style + `--pw-*` custom properties (React's CSSProperties has no
 *  index signature for custom props). */
type PwStyle = CSSProperties & Record<`--pw-${string}`, string>;

/* ── verb glyphs (the 8 prototype <symbol id="v-*"> paths, verbatim) ────── */

const VERB_PATHS: Record<VerbIcon, { d: string; cap?: 'round'; join?: 'round' }> = {
  terrain: { d: 'm3 18 5-8 4 5 3-4 6 7z', join: 'round' },
  water: { d: 'M3 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0', cap: 'round' },
  tree: { d: 'M12 3 5 12h4l-4 6h14l-4-6h4zM12 18v3', join: 'round' },
  road: { d: 'M7 21 10 3M17 21 14 3M12 6v3m0 3v3', cap: 'round' },
  build: { d: 'M4 20V9l8-5 8 5v11zM9 20v-6h6v6', join: 'round' },
  flower: { d: 'M12 8a2 2 0 1 0 0 0M12 8c0-3 4-3 4 0s-4 4-4 0m0 0c0 3-4 3-4 0s4-4 4 0M12 12v9' },
  eval: { d: 'M4 20V4M4 20h16M8 16v-4m4 4V8m4 8v-6', cap: 'round', join: 'round' },
  plan: { d: 'M6 4h9l3 3v13H6zM9 12l1.5 1.5L14 10', cap: 'round', join: 'round' },
};

export function VerbGlyph({ icon, size, color }: { icon: VerbIcon; size: number; color?: string }) {
  const p = VERB_PATHS[icon];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      data-verb={icon}
      style={{ display: 'block', flex: '0 0 auto', color }}
    >
      <path fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap={p.cap} strokeLinejoin={p.join} d={p.d} />
    </svg>
  );
}

/* ── chrome icons (exact prototype paths; stroke/fill = currentColor) ───── */

interface IconProps { size: number; color?: string }

function svgProps(size: number, color?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    style: { display: 'block', flex: '0 0 auto', color } as CSSProperties,
  } as const;
}

export function CheckIcon({ size, color }: IconProps) {
  return (
    <svg {...svgProps(size, color)} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function GoArrowIcon({ size, color }: IconProps) {
  return (
    <svg {...svgProps(size, color)} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

export function PauseIcon({ size, color }: IconProps) {
  return (
    <svg {...svgProps(size, color)}>
      <rect x="5" y="4" width="4" height="16" rx="1.5" fill="currentColor" />
      <rect x="15" y="4" width="4" height="16" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function GearIcon({ size, color }: IconProps) {
  return (
    <svg {...svgProps(size, color)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6h.1A1.6 1.6 0 0 0 11 3a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 17 4.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 9v.1a2 2 0 1 1 0 4H21z" />
    </svg>
  );
}

/** Circular-arrow "start fresh" icon. */
export function RestartIcon({ size, color }: IconProps) {
  return (
    <svg {...svgProps(size, color)} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3.2-6.9M3 4v5h5" />
    </svg>
  );
}

/** The region-select frame (header row's region button). */
export function RegionFrameIcon({ size, color }: IconProps) {
  return (
    <svg {...svgProps(size, color)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  );
}

export function CaretDownIcon({ size, color }: IconProps) {
  return (
    <svg {...svgProps(size, color)} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ size, color }: IconProps) {
  return (
    <svg {...svgProps(size, color)} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** The card-flip arrows on a build ticket: a two-arrow cycle glyph drawn to
 *  fit the viewBox with its round caps intact (arrowheads flush against the
 *  edge would clip). */
export function FlipIcon({ size, color }: IconProps) {
  return (
    <svg {...svgProps(size, color)} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.35 5.2v5.1h-5.1M2.65 18.8v-5.1h5.1" />
      <path d="M4.78 9.45a7.65 7.65 0 0 1 12.62-2.86l3.95 3.71M19.22 14.55a7.65 7.65 0 0 1-12.62 2.86L2.65 13.7" />
    </svg>
  );
}

/** Expand-to-big-editor arrows (composer). */
export function ExpandIcon({ size, color }: IconProps) {
  return (
    <svg {...svgProps(size, color)} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 3.5h6v6M9.5 20.5h-6v-6M20.5 3.5L14 10M3.5 20.5L10 14" />
    </svg>
  );
}

/** Collapse back to the panel (the expanded editor's close). */
export function CollapseIcon({ size, color }: IconProps) {
  return (
    <svg {...svgProps(size, color)} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 3.5v6h-6M14.5 20.5v-6h6M9.5 9.5L3.5 3.5M14.5 14.5l6 6" />
    </svg>
  );
}

/* ── Wavy — the traveling cozy underline ────────────────────────────────── */

/** Prototype wave tile: 7×6 css px → 14×12 design px, 2px→4px round stroke.
 *  The SVG itself stays in its 7×6 coordinate space; background-size scales it.
 *  Spaces and quotes are percent-encoded (same rendering; strict CSS value
 *  parsers reject raw spaces/quotes inside url()). */
const waveUri = (strokeHex: string) =>
  `url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%277%27%20height=%276%27%20viewBox=%270%200%207%206%27%3E%3Cpath%20d=%27M0%203%20Q1.75%200.4%203.5%203%20T7%203%27%20fill=%27none%27%20stroke=%27%23${strokeHex}%27%20stroke-width=%272%27%20stroke-linecap=%27round%27/%3E%3C/svg%3E")`;

/** Yellow traveling wavy underline (one period per 1.2s). `dimmed` (undone
 *  entries) freezes it and greys the stroke; reduced motion freezes it too
 *  (media query in animations.css) while the underline stays visible. */
export function Wavy({ children, dimmed }: { children: ReactNode; dimmed?: boolean }) {
  const { px } = usePx();
  const style: PwStyle = {
    paddingBottom: px(6),
    marginBottom: px(-2),
    backgroundImage: waveUri(dimmed ? 'C9C2B4' : 'FFDA7E'),
    '--pw-wave-size': `${px(14)}px ${px(12)}px`,
    '--pw-wave-period': `${px(14)}px`,
  };
  return (
    <span className={`pw-wavy${dimmed ? ' pw-dimmed' : ''}`} style={style}>
      {children}
    </span>
  );
}

/* ── tick rail ──────────────────────────────────────────────────────────── */

const TICK_BG: Record<Tick['s'], string> = { ok: OK_GREEN, run: RUN_GREY, revert: REVERT_AMBER };

/* Hop-queue geometry: every tick derives its motion from the SHARED WALL
 * CLOCK (performance.now), phase-shifted HOP_STEP per index. Ticks mount one
 * by one as tools run, so a per-element loop anchored to mount time cannot
 * keep the spacing even; a shared clock can. */
const HOP_PERIOD = 1.8; // s per wave
const HOP_STEP = 0.06;  // s between neighbouring icons

/** Hop height 0..1 over one cycle: a quick ease-out rise, then a FREE DROP
 *  (accelerating, like gravity) straight back to rest — no rebound, no squash,
 *  so the queue reads lively without feeling shaky. */
function hopY(p: number): number {
  if (p < 0.08) { const q = p / 0.08; return 1 - (1 - q) * (1 - q); }
  if (p < 0.19) { const q = (p - 0.08) / 0.11; return 1 - q * q; }
  return 0;
}

const PULSE_PERIOD = 1.1; // s (the prototype tickpulse)

/** The one status pulse every "busy" indicator shares (prototype tickpulse):
 *  spread {...pulseProps(active)} onto a motion element. Callers gate `active`
 *  on reduced motion themselves. */
export function pulseProps(active: boolean): {
  animate: Record<string, number | number[]>;
  transition?: { repeat: number; duration: number; ease: 'easeInOut' };
} {
  return active
    ? {
        animate: { opacity: [1, 0.4, 1], scale: [1, 0.85, 1] },
        transition: { repeat: Infinity, duration: PULSE_PERIOD, ease: 'easeInOut' },
      }
    : { animate: { opacity: 1, scale: 1 } };
}

/** One 48-design-px rounded tile on a ticket's rail: green ok, pulsing grey
 *  while running, amber for an auto-revert; the verb glyph in white.
 *
 *  Motion: the OUTER span owns the one-shot findpop on mount (the prototype's
 *  0.34s bounce tween, never replayed); the INNER span's loop (run pulse /
 *  settled hop queue) is driven off the shared wall clock through motion
 *  values, so every icon keeps an exact HOP_STEP phase offset. */
export function TickDot({ tick, index = 0, live = true }: { tick: Tick; index?: number; live?: boolean }) {
  const reduced = useReducedMotionConfig();
  const { px } = usePx();

  // latest props for the frame-driven transforms (avoids stale closures)
  const stateRef = useRef({ running: false, still: false, index: 0 });
  stateRef.current = { running: tick.s === 'run' && !reduced, still: !!reduced || !live, index };

  const clock = useMotionValue(0);
  useAnimationFrame(() => {
    if (!stateRef.current.still) clock.set(performance.now() / 1000);
  });
  const phase = (t: number) => {
    const s = stateRef.current;
    return (((t - s.index * HOP_STEP) % HOP_PERIOD) + HOP_PERIOD) % HOP_PERIOD / HOP_PERIOD;
  };
  const y = useTransform(clock, (t) => {
    const s = stateRef.current;
    return s.still || s.running ? 0 : px(-8) * hopY(phase(t));
  });
  const scale = useTransform(clock, (t) => {
    const s = stateRef.current;
    if (s.still || !s.running) return 1;
    return 0.925 + 0.075 * Math.cos((2 * Math.PI * (t % PULSE_PERIOD)) / PULSE_PERIOD);
  });
  const opacity = useTransform(clock, (t) => {
    const s = stateRef.current;
    if (!s.running) return 1;
    return 0.7 + 0.3 * Math.cos((2 * Math.PI * (t % PULSE_PERIOD)) / PULSE_PERIOD);
  });

  return (
    <motion.span
      data-testid="tick"
      data-status={tick.s}
      title={tick.t}
      initial={reduced ? false : { opacity: 0, y: px(10), scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.34, ease: [0.34, 1.56, 0.64, 1] }}
      style={{ display: 'flex', flex: '0 0 auto' }}
    >
      <motion.span
        style={{
          y,
          scale,
          opacity,
          width: px(48),
          height: px(48),
          borderRadius: px(16),
          background: TICK_BG[tick.s],
          color: C.white,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <VerbGlyph icon={tick.i} size={px(26)} />
      </motion.span>
    </motion.span>
  );
}

/** `live` = the round is still in progress; a finished card's ticks hold still. */
export function Rail({ rail, live = true }: { rail: Tick[]; live?: boolean }) {
  const { px } = usePx();
  return (
    <div data-testid="rail" style={{ display: 'flex', flexWrap: 'wrap', gap: px(12), flex: 1 }}>
      {rail.map((tk, i) => (
        <TickDot key={i} tick={tk} index={i} live={live} />
      ))}
    </div>
  );
}

/* ── chip button (dock chips, gate rows) ────────────────────────────────── */

export type GBtnKind = 'yes' | '' | 'no';

/** White / green-white / rose pill chip with the prototype's pop-in and press
 *  feedback. `delay` staggers the pop (seconds). */
/** Small dark label bubble above a control on hover/focus — the affordance
 *  hint for icon-only buttons (header row) and the roster's platform names. */
export function HoverTip({ label, children, style }: { label: string; children: ReactNode; style?: CSSProperties }) {
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  const anchorRef = useRef<HTMLSpanElement>(null);
  // The bubble renders through a PORTAL at a fixed position measured from the
  // anchor: an inline-absolute tip gets clipped by panel overflow and buried
  // under later stacking contexts (the mode row); document.body has neither.
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const show = () => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setAt({ x: r.left + r.width / 2, y: r.top });
  };
  const hide = () => setAt(null);
  return (
    <span
      ref={anchorRef}
      style={{ position: 'relative', display: 'inline-flex', ...style }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {at && (
              <motion.span
                initial={reduced ? { opacity: 0, x: '-50%', y: '-100%' } : { opacity: 0, x: '-50%', y: `calc(-100% + ${px(6)}px)`, scale: 0.85 }}
                animate={{ opacity: 1, x: '-50%', y: '-100%', scale: 1 }}
                exit={{ opacity: 0, x: '-50%', transition: exitTransition }}
                transition={springs.stiff}
                role="tooltip"
                style={{
                  position: 'fixed', left: at.x, top: at.y - px(10),
                  background: C.frameDark, color: C.white, borderRadius: px(14),
                  padding: `${px(8)}px ${px(16)}px`, fontFamily: font.family,
                  fontWeight: fw(800), fontSize: pxf(23), lineHeight: 1.2,
                  whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 500,
                  boxShadow: `0 ${px(4)}px ${px(12)}px ${inkTint(0.28)}`,
                }}
              >
                {label}
              </motion.span>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}

export function GBtn({
  label,
  kind = '',
  onClick,
  delay = 0,
}: {
  label: string;
  kind?: GBtnKind;
  onClick: () => void;
  delay?: number;
}) {
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  const bg = kind === 'yes' ? C.tileGreen : kind === 'no' ? '#E8B4B4' : 'rgba(255,255,255,.85)';
  const color = kind === 'yes' ? C.white : kind === 'no' ? '#5a2b2b' : C.inkText;
  return (
    <motion.button
      data-testid="gbtn"
      data-kind={kind}
      initial={reduced ? false : { y: px(16), scale: 0.9, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1, transition: { ...springs.bouncy, delay: reduced ? 0 : delay } }}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.93 }}
      onClick={onClick}
      style={{
        border: 'none',
        appearance: 'none',
        cursor: cursors.clickable,
        borderRadius: 999,
        padding: `${px(14)}px ${px(28)}px`,
        fontFamily: font.family,
        fontWeight: fw(900),
        fontSize: pxf(27),
        color,
        background: bg,
        boxShadow: `0 ${px(2)}px ${px(8)}px ${inkTint(0.14)}`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </motion.button>
  );
}

/* ── determinate / indeterminate dock progress ──────────────────────────── */

/** Flat segment pills — the dock's determinate progress (never a % meter). */
export function Segs({ done, total }: { done: number; total: number }) {
  const { px } = usePx();
  return (
    <div data-testid="segs" style={{ display: 'flex', gap: px(10), marginTop: px(16) }}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          data-testid="seg"
          data-done={i < done}
          style={{
            flex: 1,
            height: px(12),
            borderRadius: px(8),
            background: i < done ? OK_GREEN : 'rgba(255,255,255,.6)',
          }}
        />
      ))}
    </div>
  );
}

/** Indeterminate 45° yellow/ink stripe bar (thinking / small-job work). */
export function StripeBar() {
  const { px } = usePx();
  const style: PwStyle = {
    height: px(16),
    borderRadius: px(10),
    marginTop: px(16),
    overflow: 'hidden',
    opacity: 0.88,
    backgroundImage: `repeating-linear-gradient(45deg, ${C.tileYellow} 0 ${px(20)}px, ${C.inkText} ${px(20)}px ${px(40)}px)`,
    backgroundSize: `${px(56)}px ${px(56)}px`,
    '--pw-stripe-travel': `${px(56)}px`,
  };
  return <div className="pw-stripes" data-testid="stripebar" style={style} />;
}

/* ── undo affordances ───────────────────────────────────────────────────── */

/** The small field-deep undo chip on tickets and blueprint recaps. */
export function UndoChip({ label, onClick }: { label: string; onClick: () => void }) {
  const { px, pxf, fw } = usePx();
  return (
    <motion.button
      data-testid="undochip"
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      style={{
        marginLeft: 'auto',
        border: 'none',
        appearance: 'none',
        background: FIELD_DEEP,
        borderRadius: px(20),
        padding: `${px(10)}px ${px(20)}px`,
        fontFamily: font.family,
        fontWeight: fw(800),
        fontSize: pxf(24),
        cursor: cursors.clickable,
        color: C.inkText,
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </motion.button>
  );
}

/** Rotated amber "UNDONE" stamp, popping in at scale 1.6→1. The host entry is
 *  position:relative and dims its own content to 45%. */
export function UndoneStamp() {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  return (
    <motion.span
      data-testid="undone-stamp"
      initial={reduced ? false : { scale: 1.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1, transition: springs.bouncy }}
      style={{
        position: 'absolute',
        top: '50%',
        right: px(28),
        y: '-50%',
        rotate: -9,
        border: `${pxf(5)}px solid ${REVERT_AMBER}`,
        color: REVERT_AMBER,
        fontFamily: font.family,
        fontWeight: fw(900),
        fontSize: pxf(23),
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        padding: `${px(6)}px ${px(18)}px`,
        borderRadius: px(14),
        background: 'rgba(255,255,255,.9)',
        whiteSpace: 'nowrap',
        zIndex: 2,
      }}
    >
      {t('agent2.undone')}
    </motion.span>
  );
}

/* ── summary fold — the model's closing prose inside a card ─────────────── */

/** Collapsible closing note under a card's content: expanded while the card is
 *  the latest entry, folded to one toggle row once the log moves on; the user
 *  can reopen it any time. Height animates; reduced motion snaps. */
export function SummaryFold({ text, open, onToggle }: { text: string; open: boolean; onToggle: () => void }) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  if (!text.trim()) return null;
  return (
    <div style={{ borderTop: `${Math.max(1, px(2))}px solid ${CARD_LINE}`, marginTop: px(4), paddingTop: px(12) }}>
      <button
        type="button"
        data-testid="summary-toggle"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: px(10), width: '100%',
          border: 'none', appearance: 'none', background: 'transparent', padding: 0,
          cursor: cursors.clickable, fontFamily: font.family, fontWeight: fw(800),
          fontSize: pxf(22), color: C.textSecondary, textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }}>
          <CaretDownIcon size={px(24)} color={C.textSecondary} />
        </span>
        {t('agent2.card_note')}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            data-testid="summary-body"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0, transition: { duration: 0.22, ease: exitTransition.ease } }}
            transition={springs.gentle}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ paddingTop: px(10), fontSize: pxf(27), fontWeight: fw(700), color: C.inkText, lineHeight: 1.45, fontFamily: font.family }}>
              <Markdown text={text} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── entry shell — shared enter animation + undone treatment ────────────── */

/** Wraps every log entry: translateY+fade enter (spec §UI.4), and when
 *  `undone` dims the content to 45% and overlays the UNDONE stamp. */
export function EntryShell({
  undone,
  children,
  style,
  testId,
}: {
  undone?: boolean;
  children: ReactNode;
  style?: CSSProperties;
  testId?: string;
}) {
  const reduced = useReducedMotionConfig();
  const { px } = usePx();
  return (
    <motion.div
      data-testid={testId}
      data-undone={undone ? 'true' : undefined}
      initial={reduced ? false : { opacity: 0, y: px(14) }}
      animate={{ opacity: 1, y: 0, transition: springs.bouncy }}
      style={{ position: 'relative', flex: '0 0 auto', ...style }}
    >
      <div style={{ opacity: undone ? 0.45 : 1 }}>{children}</div>
      {undone && <UndoneStamp />}
    </motion.div>
  );
}

/* ── prettyModel ────────────────────────────────────────────────────────── */

/** Friendly model name: "claude-opus-4-8" → "Claude Opus 4 8",
 *  "gpt-5.5" → "GPT 5 5", "glm-4.6" → "GLM 4 6", "kimi-k2-…" → "Kimi K2 …"
 *  (K2 title-cases naturally; GPT/GLM need the acronym fixups). */
/** Fixed casings for tokens that Title Case would mangle. Derived from a
 *  cross-platform corpus (OpenAI, OpenRouter catalog, ollama gateways). */
const BRAND_CASE: Record<string, string> = {
  gpt: 'GPT', chatgpt: 'ChatGPT', oss: 'OSS', glm: 'GLM', vl: 'VL', ai: 'AI',
  tts: 'TTS', it: 'IT', moe: 'MoE', qwq: 'QwQ', deepseek: 'DeepSeek',
  openrouter: 'OpenRouter', llava: 'LLaVA', medgemma: 'MedGemma',
  codellama: 'CodeLlama', minimax: 'MiniMax', k2: 'K2',
};
/** Families whose glued version splits off: llama3.1 → llama 3.1. */
const GLUE_SPLIT = /^([a-z]{3,})(\d+(?:\.\d+)?)$/i;
const SIZE = /^\d+(?:\.\d+)?[bkm]$/i;          // 70b, 1.5b, 32k
const QUANT = /^(q\d+|fp\d+|int\d+|a\d+b)$/i;  // q4, fp16, int8, a4b (MoE actives)
const DATE_LONG = /^\d{6,}$/;                  // -20251001
const DATE_MMDD = /^(0[1-9]|1[0-2])\d{2}$/;    // -0125 / -1106 trailing snapshots
const VNUM = /^[vmr]\d+(?:\.\d+)?$/i;          // v1, m2.1, r1
const OSERIES = /^o\d$/;                       // OpenAI o1/o3/o4 stay lowercase-o
const INT12 = /^\d{1,2}$/;                     // dash-version parts (4-8 → 4.8)

/**
 * Friendly model name from any id shape the nine platforms emit. The mono id
 * always renders alongside it in menus, so this favors readability: vendor
 * prefixes and date snapshots drop, versions keep their dots (and dash
 * versions regain them), sizes/quants uppercase, brands keep their casing.
 */
export function prettyModel(id: string): string {
  const seg = id.split('/').pop() ?? id;
  // ollama/openrouter ":tag" folds into the token stream; ":latest" is noise
  const rawTokens = seg
    .split(/[:\-_]/)
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== 'latest');

  // drop date snapshots: one long token, or a split year + trailing pairs
  const tokens: string[] = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const tk = rawTokens[i]!;
    if (DATE_LONG.test(tk)) continue;
    if (/^(19|20)\d{2}$/.test(tk) && rawTokens.slice(i + 1).every((r) => /^\d{1,2}$/.test(r))) break;
    if (i === rawTokens.length - 1 && tokens.length > 0 && DATE_MMDD.test(tk)) continue;
    tokens.push(tk);
  }

  // split glued family+version (llama3.1 → llama, 3.1)
  const split: string[] = [];
  for (const tk of tokens) {
    const m = !SIZE.test(tk) && !QUANT.test(tk) ? GLUE_SPLIT.exec(tk) : null;
    if (m && !BRAND_CASE[tk.toLowerCase()]) split.push(m[1]!, m[2]!);
    else split.push(tk);
  }

  // join runs of small integers into dotted versions (opus, 4, 8 → opus, 4.8)
  const joined: string[] = [];
  for (const tk of split) {
    const prev = joined[joined.length - 1];
    if (INT12.test(tk) && prev !== undefined && /^\d{1,2}(\.\d{1,2})*$/.test(prev)) {
      joined[joined.length - 1] = `${prev}.${tk}`;
    } else {
      joined.push(tk);
    }
  }

  const words = joined.map((tk) => {
    const lo = tk.toLowerCase();
    if (BRAND_CASE[lo]) return BRAND_CASE[lo];
    if (OSERIES.test(lo)) return lo;                       // o3 stays o3
    if (SIZE.test(lo)) return lo.toUpperCase();            // 70B / 32K
    if (QUANT.test(lo)) return lo.toUpperCase();           // Q4 → uppercase family
    if (VNUM.test(lo)) return lo.toUpperCase();            // V1 / R1 / M2.1
    if (/^\d/.test(lo)) return lo;                         // bare versions: 4.8, 4o
    return lo.charAt(0).toUpperCase() + lo.slice(1);
  });

  const name = words.join(' ').replace(/\s+/g, ' ').trim();
  return name || seg || id;
}
