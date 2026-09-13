/*
 * atoms.tsx — the parts both pages of the stylize window are built from.
 *
 * They live here rather than in `ui/primitives/` because each one encodes something about THIS
 * window: the status slot that is always standing whether or not there is anything to report, the
 * primary verb that pulses at the moment it becomes pressable, the picture box that is drawn at the
 * map's own ratio and never at its own.
 */
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { motion, useAnimationControls, useReducedMotionConfig } from 'framer-motion';
import { buttonMotion, colors, cursors, font, pressable, radii } from '../../../../design/styles';
import { skin, windowFooterGhost, windowFooterPrimary } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';
import { Spinner } from '../../../../primitives/Spinner';
import { useT } from '../../../../../i18n/context';
import type { StylizeStatus } from '../../../../../io/stylize';
import { MAP_ASPECT, paintSampleArt, type SampleArt } from './sample-art';
import { amplitude, framerMotion, staggerDelay } from './motion';

/** What the status slot can say: a dialect's classified refusal, or the one house-made outcome
 *  (the map changed under an out-of-window edit while the job was painting, so the take was
 *  discarded rather than shelved). */
export type SlotStatus = StylizeStatus | 'map_changed';

/** The i18n key carrying each refusal's one short line. */
const STATUS_KEYS: Record<SlotStatus, string> = {
  bad_key: 'stylize.status_bad_key',
  refused: 'stylize.status_refused',
  network: 'stylize.status_network',
  bad_response: 'stylize.status_bad_response',
  device: 'stylize.status_device',
  inappropriate: 'stylize.status_inappropriate',
  unchecked: 'stylize.status_unchecked',
  map_changed: 'stylize.status_map_changed',
};

/** A field: its own label above a box that carries its own radius (so the house focus-ring marker,
 *  which exists for bare inputs inside rounded wrappers, is not this shape's business). */
export const fieldLabel: CSSProperties = { ...roleFont('caption'), color: skin.ink };

export const fieldBox: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: skin.plate,
  border: `1.5px solid ${skin.line}`,
  borderRadius: radii.md,
  padding: '9px 11px',
  fontFamily: font.family,
  ...roleFont('field'),
  color: skin.ink,
  resize: 'none',
};

/**
 * The props that make a part arrive as the `index`-th member of its page.
 *
 * SPREAD ONTO THE PART'S OWN ROOT rather than onto a wrapper around it: both pages place their
 * parts by grid or flex, and a box interposed between a part and the box it was placed in changes
 * where it stands. Both pages read this, so the two arrive at one tempo.
 */
export function entering(index: number) {
  return {
    initial: { opacity: 0, y: amplitude('stylize.row.stagger') },
    animate: { opacity: 1, y: 0 },
    transition: { ...framerMotion('stylize.row.stagger'), delay: staggerDelay('stylize.row.stagger', index) },
  } as const;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

/**
 * The window's footer row: one status slot that is ALWAYS standing, and the verbs after it.
 *
 * The slot keeps its height whether or not it has anything to say, which is what lets a refusal
 * arrive without moving the button the hand is already travelling to.
 */
export function WindowFoot({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flex: 'none' }}>{children}</div>;
}

/**
 * The footer's permanent line.
 *
 * `busy` STANDS A SPINNER IN IT, and it is for a wait this row is the only sign of — the connection
 * page's verify, which has nothing else on screen to carry it. A page that already shows its wait
 * somewhere else leaves it out: one state, one loading indicator, or the eye is asked which of two
 * is the job.
 */
export function StatusSlot({ status, busy = false }: { status: SlotStatus | null; busy?: boolean }) {
  const t = useT();
  const failed = !busy && status !== null;
  const style: CSSProperties = {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    borderRadius: radii.sm,
    padding: '5px 10px',
    ...roleFont('caption'),
    background: failed ? colors.dangerBg : 'transparent',
    color: failed ? colors.dangerText : skin.muted,
  };
  return (
    <div style={style} role="status">
      {busy ? <Spinner size={15} /> : null}
      {failed ? (
        <motion.span
          key={status}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={framerMotion('stylize.status.pop')}
        >
          {t(STATUS_KEYS[status])}
        </motion.span>
      ) : null}
    </div>
  );
}

/** The page's own confirming verb. It never appears or disappears: it stands disabled until the
 *  page has what it needs, and grows once at the moment it becomes pressable. */
export function PrimaryVerb({ disabled, onClick, children }: {
  disabled: boolean; onClick: () => void; children: ReactNode;
}) {
  const controls = useAnimationControls();
  const reduced = useReducedMotionConfig() === true;
  const wasDisabled = useRef(disabled);

  useEffect(() => {
    if (wasDisabled.current && !disabled && !reduced) {
      void controls.start({ scale: [1, 1 + amplitude('stylize.button.arm'), 1] }, framerMotion('stylize.button.arm'));
    }
    wasDisabled.current = disabled;
  }, [disabled, reduced, controls]);

  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      animate={controls}
      // A refusing control does not answer the pointer: the growth would promise a press that the
      // `disabled` attribute then swallows.
      {...(disabled ? {} : { whileHover: buttonMotion.whileHover, whileTap: buttonMotion.whileTap })}
      transition={buttonMotion.transition}
      style={{
        ...windowFooterPrimary,
        flex: 'none',
        padding: '12px 26px',
        cursor: disabled ? cursors.blocked : cursors.clickable,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </motion.button>
  );
}

/** The page's way out, in the house ghost. */
export function GhostVerb({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      {...buttonMotion}
      style={{ ...windowFooterGhost, cursor: cursors.clickable }}
    >
      {children}
    </motion.button>
  );
}

/** The round icon control the studio's footer opens the connection form with: an icon tile, so it
 *  takes the tiles' own growth rather than the wider verbs' beside it. */
export function IconVerb({ label, onClick, children }: {
  label: string; onClick: () => void; children: ReactNode;
}) {
  // The pressable growth as VARIANTS rather than spread props, so a glyph inside can answer the
  // same hover (the gear's wink) instead of only the button's outline growing around it.
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      initial="rest"
      animate="rest"
      whileHover="hover"
      whileTap="tap"
      variants={{ rest: { scale: 1 }, hover: pressable.whileHover, tap: pressable.whileTap }}
      transition={pressable.transition}
      style={{
        width: 30, height: 30, flex: 'none', border: 'none', borderRadius: radii.pill,
        background: skin.inset, color: skin.plateInk, cursor: cursors.clickable,
        display: 'flex', alignItems: 'center', justifyContent: 'center', ...roleFont('head'),
      }}
    >
      {children}
    </motion.button>
  );
}

/**
 * A picture of one direction at the map's ratio: the committed sample where one exists, the
 * palette-painted fallback otherwise.
 *
 * The box's shape is the map's whatever the source is, so a sample and a fallback occupy the same
 * rect and a direction never changes size when its asset lands.
 */
export function SampleTile({ url, art, radius = 8, style }: {
  url: string | null; art: SampleArt; radius?: number; style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (!url && ref.current) paintSampleArt(ref.current, art);
  }, [url, art]);

  const box: CSSProperties = {
    width: '100%',
    aspectRatio: String(MAP_ASPECT),
    borderRadius: radius,
    display: 'block',
    background: art.paper,
    ...style,
  };
  if (url) return <div aria-hidden style={{ ...box, backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />;
  return <canvas aria-hidden ref={ref} style={box} />;
}

/** The connection gear, drawn rather than typed: eight round-capped teeth around an open hub, in
 *  the button's own ink. It leans into a turn while its button is hovered, riding `IconVerb`'s
 *  variants; the turn is decoration, so reduced motion leaves the gear square. */
export function GearGlyph() {
  const teeth = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const cos = Math.cos(a), sin = Math.sin(a);
    return { x1: 12 + 8.2 * cos, y1: 12 + 8.2 * sin, x2: 12 + 10.4 * cos, y2: 12 + 10.4 * sin };
  });
  return (
    <motion.span
      aria-hidden
      variants={{ rest: { rotate: 0 }, hover: { rotate: 32 }, tap: { rotate: 48 } }}
      style={{ display: 'flex' }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="5.4" />
        {teeth.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />)}
      </svg>
    </motion.span>
  );
}
