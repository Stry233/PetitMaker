/*
 * Keyless resting screen shown before connection setup. Its sample orders are inert illustrations,
 * not menu items. The board rotates through them with a matching shoulder plume; hover adds only an
 * ambient sleeping movement. Reduced motion shows a still board and badge. Each row uses a capture
 * of the open map when available and falls back to its tool glyph.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { HelpLink, zoneEnter } from './atoms';

import { useT } from '../../i18n/context';
import { colors, cursors, font } from '../design/styles';
import { INK, INSET, PLATE_INK } from '../design/tokens';
import { roleFont } from '../design/text-weight';
import { windowFooterPrimary } from '../design/window-skin';
import { getCharacterHandle, setDreamBadge } from './character/Character';
import { Icon, type IconId } from './icons';
import { DREAM } from './sketchbook/sketch-motion';
import { edge } from './tokens';

import thumbVillage from '../../assets/agent/dreams/dream-village.png';
import thumbForest from '../../assets/agent/dreams/dream-forest.png';
import thumbRoad from '../../assets/agent/dreams/dream-road.png';
import thumbPond from '../../assets/agent/dreams/dream-pond.png';
import thumbHill from '../../assets/agent/dreams/dream-hill.png';

/** Five sample orders and captures of their built outcomes. */
const DREAM_THUMBS: Record<string, string> = {
  village: thumbVillage, forest: thumbForest, road: thumbRoad, pond: thumbPond, hill: thumbHill,
};
export const DREAMS: readonly { id: string; icon: IconId; titleKey: string; subKey: string }[] = [
  { id: 'village', icon: 'pw-object-place', titleKey: 'agent3.dream_village', subKey: 'agent3.dream_village_sub' },
  { id: 'forest', icon: 'pw-forest', titleKey: 'agent3.dream_forest', subKey: 'agent3.dream_forest_sub' },
  { id: 'road', icon: 'pw-road', titleKey: 'agent3.dream_road', subKey: 'agent3.dream_road_sub' },
  { id: 'pond', icon: 'pw-water', titleKey: 'agent3.dream_pond', subKey: 'agent3.dream_pond_sub' },
  { id: 'hill', icon: 'pw-terrain-raise', titleKey: 'agent3.dream_hill', subKey: 'agent3.dream_hill_sub' },
];

/** Number of sample rows in the rotating floating-panel window. */
const SHOWN = 3;

/** Board-row gap in CSS pixels, also used to derive the reserved height. */
const ROW_GAP = 6;

/** Row thumbnail size in CSS pixels. */
const THUMB = { width: 52, height: 38 } as const;

/** The inner content scrolls while the sole Connect action remains fixed and visible. */
const WRAP_STYLE: CSSProperties = {
  flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14,
};
/** Scrollable welcome, board and note; the parent job zone already owns the scrollbar gutter. */
const SCROLL_STYLE: CSSProperties = {
  flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
  display: 'flex', flexDirection: 'column', gap: 14,
};
/** Clips transient row animation while preventing the visible row stack from shrinking. */
const ROWS_STYLE: CSSProperties = {
  position: 'relative', display: 'flex', flexDirection: 'column', gap: ROW_GAP,
  overflow: 'hidden', flexShrink: 0,
};

/** Hidden zero-height clip that preserves measurable layout without adding scrollable overflow. */
const MEASURE_CLIP_STYLE: CSSProperties = {
  position: 'absolute', left: 0, right: 0, top: 0, height: 0,
  overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none',
};

/** Off-flow stack used to measure every localized row at the board's actual width. */
const MEASURE_STYLE: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: ROW_GAP,
};

/** CSS-pixel probe used to remove page and UI zoom from DOMRect measurements. */
const SCALE_PROBE_W = 96;

const ROW_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%', boxSizing: 'border-box',
  background: INSET, borderRadius: 12, padding: 8, textAlign: 'left',
};

const SHOT_STYLE: CSSProperties = {
  position: 'relative', flex: '0 0 auto', width: THUMB.width, height: THUMB.height,
  borderRadius: 8, overflow: 'hidden', border: edge, background: colors.surfaceSecondary,
};

/** The plume's order for cycle `b`, offset from the row that just arrived. */
const dreamingAt = (b: number): number => (b === 0 ? 0 : (b + 2) % DREAMS.length);

/** How long a stir waits before another pointer pass can raise one. */
const STIR_GAP_MS = 1500;

/** Returns the tallest cyclic window of natural row heights, including gaps, or 0 until measured. */
export function boardHeight(poolHeights: readonly number[]): number {
  if (poolHeights.length < SHOWN) return 0;
  let tallest = 0;
  for (let start = 0; start < poolHeights.length; start++) {
    let sum = 0;
    for (let i = 0; i < SHOWN; i++) sum += poolHeights[(start + i) % poolHeights.length]!;
    tallest = Math.max(tallest, sum);
  }
  return tallest + (SHOWN - 1) * ROW_GAP;
}

/** Observes natural row heights in CSS pixels as fonts, locale and available width change. */
function usePoolRowHeights(
  stack: RefObject<HTMLDivElement | null>,
  probe: RefObject<HTMLDivElement | null>,
): number[] {
  const [heights, setHeights] = useState<number[]>([]);
  useLayoutEffect(() => {
    const el = stack.current;
    if (!el) return undefined;
    const measure = (): void => {
      // A zero-width probe indicates a layout-free environment such as jsdom.
      const probeW = probe.current?.getBoundingClientRect().width ?? 0;
      const scale = probeW > 0 ? probeW / SCALE_PROBE_W : 1;
      // Round up so container and rows cannot land on opposite fractional-pixel boundaries.
      const next = [...el.children].map((row) => Math.ceil(row.getBoundingClientRect().height / scale));
      setHeights((was) => (
        was.length === next.length && was.every((h, i) => h === next[i]) ? was : next
      ));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const row of el.children) ro.observe(row);
    return () => ro.disconnect();
  });
  return heights;
}

export function DreamOffice({ onConnect, pinned = false }: {
  onConnect(): void;
  /** Docked panels show the full pool without rotation or reserved-height measurement. */
  pinned?: boolean;
}) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const [beat, setBeat] = useState(0);
  const stirredAt = useRef(0);
  /** Departing row retained as an overlay for its exit animation. */
  const [leaving, setLeaving] = useState<typeof DREAMS[number] | null>(null);
  const prevBeatRef = useRef(0);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Fixed board reserve derived from the tallest visible-window combination. */
  const measureRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const poolHeights = usePoolRowHeights(measureRef, probeRef);
  const reserve = boardHeight(poolHeights);

  /** Drives board beats and the character's dream plume for the lifetime of this screen. */
  useEffect(() => {
    setDreamBadge('zzz');
    if (reduced) {
      // Reduced motion keeps the first board and plume state still.
      setDreamBadge(DREAMS[dreamingAt(0)]!.icon);
      return () => { setDreamBadge('off'); };
    }
    const t0 = performance.now();
    let frame = 0;
    let at = -1;
    let twitched = false;
    let resettled = false;
    // Composite one-shot movement onto the persistent sleeping pose.
    const garnish = (move: typeof DREAM.twitchFrames): void => {
      const el = getCharacterHandle()?.parts[move.part];
      if (!el || typeof el.animate !== 'function') return;
      el.animate(move.keyframes, {
        duration: move.dur, easing: move.easing, composite: move.composite, fill: 'none',
      });
    };
    const tick = () => {
      const now = performance.now() - t0;
      const b = Math.floor(now / DREAM.cycle);
      if (b !== at) { at = b; twitched = false; resettled = false; setBeat(b); }
      const into = now - b * DREAM.cycle;
      if (!twitched && into >= DREAM.twitch) {
        twitched = true;
        garnish(DREAM.twitchFrames);
      }
      // Add a sparse resettling movement on alternating cycles.
      if (!resettled && into >= DREAM.resettle && b % DREAM.resettleEvery === 1) {
        resettled = true;
        garnish(DREAM.resettleFrames);
      }
      setDreamBadge(into >= DREAM.glyphIn && into < DREAM.glyphOut
        ? DREAMS[dreamingAt(b)]!.icon
        : 'zzz');
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setDreamBadge('off');
    };
  }, [reduced]);

  /** Starts one departing-row overlay per board beat. */
  useEffect(() => {
    if (reduced || pinned) return undefined;
    const prev = prevBeatRef.current;
    prevBeatRef.current = beat;
    if (beat === prev) return undefined;
    setLeaving(DREAMS[prev % DREAMS.length]!);
    leaveTimerRef.current = setTimeout(() => setLeaving(null), DREAM.rowOut.dur);
    return () => clearTimeout(leaveTimerRef.current);
  }, [beat, reduced, pinned]);

  /** Applies a pre-paint FLIP animation to rows that survive a board beat. */
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const wasAt = useRef(new Map<string, number>());
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const wasPinned = useRef(pinned);
  const glideRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowEls.current.set(id, el);
    else rowEls.current.delete(id);
  }, []);
  useLayoutEffect(() => {
    // Board-relative positions exclude panel travel; docking reseeds without a glide.
    const base = rowsRef.current?.getBoundingClientRect().top ?? 0;
    const reseed = wasPinned.current !== pinned;
    wasPinned.current = pinned;
    const now = new Map<string, number>();
    for (const [id, el] of rowEls.current) {
      const top = el.getBoundingClientRect().top - base;
      now.set(id, top);
      const before = wasAt.current.get(id);
      if (reduced || reseed || before === undefined || Math.abs(before - top) < 0.5) continue;
      if (typeof el.animate !== 'function') continue;
      el.animate(
        [{ transform: `translateY(${before - top}px)` }, { transform: 'none' }],
        { duration: DREAM.rowGlide.dur, easing: DREAM.rowGlide.easing, fill: 'none' },
      );
    }
    wasAt.current = now;
  }, [beat, reduced, pinned]);

  /** A pointer passing over the board: she is asleep, and something moved. Nothing else happens. */
  const stir = (): void => {
    if (reduced) return;
    const now = performance.now();
    if (now - stirredAt.current < STIR_GAP_MS) return;
    stirredAt.current = now;
    const move = DREAM.stirFrames;
    const el = getCharacterHandle()?.parts[move.part];
    if (el && typeof el.animate === 'function') {
      el.animate(move.keyframes, {
        duration: move.dur, easing: move.easing, composite: move.composite, fill: 'none',
      });
    }
  };

  return (
    <motion.div {...zoneEnter(reduced)} data-testid="dream-office" style={WRAP_STYLE}>
      <div data-testid="dream-scroll" style={SCROLL_STYLE}>
        <p style={{ ...roleFont('label'), fontFamily: font.family, color: PLATE_INK, lineHeight: 1.5, margin: 0 }}>
          {t('agent3.dream_say')}
        </p>
        <div
          ref={rowsRef}
          data-testid="dream-rows"
          onPointerMove={stir}
          // Docked rows use their full natural content height.
          style={!pinned && reserve > 0 ? { ...ROWS_STYLE, height: reserve } : ROWS_STYLE}
        >
          {!pinned && (
            <div aria-hidden style={MEASURE_CLIP_STYLE}>
              <div ref={probeRef} data-testid="dream-measure-scale" style={{ width: SCALE_PROBE_W, height: 0 }} />
              <div ref={measureRef} data-testid="dream-measure" style={MEASURE_STYLE}>
                {DREAMS.map((order) => <MeasureRow key={order.id} order={order} />)}
              </div>
            </div>
          )}
          {leaving && <DepartingRow order={leaving} />}
          {(pinned
            ? DREAMS
            : Array.from({ length: SHOWN }, (_, i) => DREAMS[(beat + i) % DREAMS.length]!)
          ).map((order) => (
            <DreamRow
              key={order.id}
              order={order}
              reduced={reduced}
              glideRef={glideRef}
            />
          ))}
        </div>
        <p style={{ ...roleFont('note'), fontFamily: font.family, color: colors.brownText, lineHeight: 1.45, margin: 0, padding: '0 3px' }}>
          {t('agent3.dream_note')} <HelpLink page="agent-setup" anchor="agsetup-keys" />
        </p>
      </div>
      <div style={{ flex: '0 0 auto', display: 'flex' }}>
        <button
          type="button"
          data-testid="dream-connect"
          onClick={onConnect}
          style={{ ...windowFooterPrimary, flex: 1, whiteSpace: 'nowrap', cursor: cursors.clickable }}
        >
          {t('agent3.dream_connect')}
        </button>
      </div>
    </motion.div>
  );
}

type DreamOrder = { id: string; icon: IconId; titleKey: string; subKey: string };

/** Shared thumbnail and text for visible, departing and measuring rows. */
function RowContent({ order }: { order: DreamOrder }) {
  const t = useT();
  return (
    <>
      <span style={SHOT_STYLE}>
        {/* The dreamed order's own built outcome; decorative beside the title that names it. */}
        <img
          data-testid="dream-thumb"
          src={DREAM_THUMBS[order.id]}
          alt=""
          aria-hidden
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: INK }}>
          <Icon id={order.icon} size={14} />
          <span style={{ ...roleFont('chip'), fontFamily: font.family, color: INK }}>{t(order.titleKey)}</span>
        </span>
        <span style={{ ...roleFont('note'), fontFamily: font.family, color: colors.brownText }}>
          {t(order.subKey)}
        </span>
      </span>
    </>
  );
}

/** Inert board row whose delayed entrance follows the surviving rows' glide. */
function DreamRow({ order, reduced, glideRef }: {
  order: DreamOrder;
  reduced: boolean;
  /** Registers the row for board-relative FLIP measurements. */
  glideRef(id: string, el: HTMLDivElement | null): void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (reduced || !el || typeof el.animate !== 'function') return;
    el.animate(
      [
        { opacity: 0, transform: 'translateY(18px) scale(.97)' },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: DREAM.rowIn.dur, delay: DREAM.rowIn.delay, easing: DREAM.rowIn.easing,
        fill: 'backwards',
      },
    );
  }, [reduced]);

  return (
    <div
      ref={(el) => { ref.current = el; glideRef(order.id, el); }}
      data-testid="dream-row"
      data-order={order.id}
      style={ROW_STYLE}
    >
      <RowContent order={order} />
    </div>
  );
}

/** Absolute overlay for the row leaving during the current board beat. */
function DepartingRow({ order }: { order: DreamOrder }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    el.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate(-18px,-6px) scale(.98)' }],
      { duration: DREAM.rowOut.dur, easing: DREAM.rowOut.easing, fill: 'forwards' },
    );
  }, []);

  return (
    <div
      ref={ref}
      data-testid="dream-row-leaving"
      data-order={order.id}
      style={{ ...ROW_STYLE, position: 'absolute', top: 0, left: 0, right: 0 }}
    >
      <RowContent order={order} />
    </div>
  );
}

/** Off-flow copy whose content and box match a standing row for measurement. */
function MeasureRow({ order }: { order: DreamOrder }) {
  return (
    <div style={ROW_STYLE}>
      <RowContent order={order} />
    </div>
  );
}
