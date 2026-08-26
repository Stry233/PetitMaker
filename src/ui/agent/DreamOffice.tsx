/*
 * DreamOffice.tsx — the disconnected screen: with no key she sleeps at her desk and dreams of orders
 * to fill (normative artifact `disconnected` / `DOM.welcome` / `dreamEngine`).
 *
 * IT IS THE PANEL'S REST, NOT ITS SETUP. Setup is a form the user WALKS INTO from here, which is
 * what the Connect verb is: a panel that opened straight onto a key field asked for a credential
 * before saying what it was for, and left the character's one sleeping pose with nothing on screen
 * to explain it.
 *
 * THE ROWS ARE INERT PICTURES. They are a dream, not a menu: none is pressable, none highlights, and
 * pressing anywhere on the board does nothing. The one thing that moves is the board turning over as
 * a queue and the plume at her shoulder — the zzz giving way to the dreamed order's own tool glyph
 * and coming back on one breath. THE PLUME STANDS OUTSIDE THE POSE (`character/Character.tsx`
 * `setDreamBadge`): it is the only thing on this screen that does not move, which is what makes a
 * 2.8-degree twitch of a sleeping body legible.
 *
 * THE STIR IS AMBIENT. A pointer passing over the board wakes a small movement out of her and
 * nothing else — no wake, no state, no press target. Reduced motion drops the whole loop and paints
 * the still: the board standing and the plume wearing the first order's glyph.
 *
 * Each row's picture is the OPEN MAP, like every other picture in this panel: she is dreaming about
 * the island that is standing, and with no renderer to answer yet the row shows the order's own
 * glyph rather than a drawing of an island nobody has.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useReducedMotionConfig } from 'framer-motion';

import { useT } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { colors, cursors, font } from '../design/styles';
import { INK, INSET, PLATE_INK } from '../design/tokens';
import { roleFont } from '../design/text-weight';
import { windowFooterPrimary } from '../design/window-skin';
import { getCharacterHandle, setDreamBadge } from './character/Character';
import { Icon, type IconId } from './icons';
import { MapShot } from './map-shot';
import { DREAM } from './sketchbook/sketch-motion';
import { edge } from './tokens';

/**
 * THE ORDERS SHE DREAMS OF. Five, so the board's three-row window turns over without a row ever
 * arriving where it just left, and each is a real order this app can carry (the artifact's own
 * seven, less the two whose verbs the panel's tool set says twice).
 */
export const DREAMS: readonly { id: string; icon: IconId; titleKey: string; subKey: string }[] = [
  { id: 'village', icon: 'pw-object-place', titleKey: 'agent3.dream_village', subKey: 'agent3.dream_village_sub' },
  { id: 'forest', icon: 'pw-forest', titleKey: 'agent3.dream_forest', subKey: 'agent3.dream_forest_sub' },
  { id: 'road', icon: 'pw-road', titleKey: 'agent3.dream_road', subKey: 'agent3.dream_road_sub' },
  { id: 'pond', icon: 'pw-water', titleKey: 'agent3.dream_pond', subKey: 'agent3.dream_pond_sub' },
  { id: 'hill', icon: 'pw-terrain-raise', titleKey: 'agent3.dream_hill', subKey: 'agent3.dream_hill_sub' },
];

/** How many of them the FLOATING board shows at once: a three-row window turned over as a queue.
 *  Docked, the zone is the window tall and the window would page through a pool that fits whole, so
 *  the docked board stands the pool entire instead (`pinned` below). */
const SHOWN = 3;

/** The gap between the board's rows, in px (artifact `.dreamRows{gap:6px}`). Named because the
 *  reserved height below is built out of it. */
const ROW_GAP = 6;

/** The row's own picture, in px (artifact `.orow` thumb). */
const THUMB = { width: 52, height: 38 } as const;

/**
 * THE SCREEN'S ONE VERB STANDS, AND THE DREAM GIVES WAY.
 *
 * The office is the panel's keyless REST, so it is the whole of what a first-run user has: the only
 * route into the setup form is `dream-connect`, since the rows are inert pictures and nothing else
 * on the screen is pressable. Left as a column that simply grew, it overflowed the record zone and
 * the zone scrolled — and a screen is read top down, so `useFollowNewest` correctly leaves it at
 * scrollTop 0 and the verb sat below the fold. Measured live at 1280x800 (record zone 186 frame px):
 * en wanted 385 and put Connect 191 px past the fold, fr 443, ru 462; `elementFromPoint` at its
 * centre answered the CANVAS or nothing at all, in every one of the seven locales.
 *
 * So the office does not grow: it fills the zone (`minHeight: 0`, which is what lets a flex item
 * shrink below its content), the dream SCROLLS inside it, and the foot is out of the scroller. The
 * zone above therefore never scrolls, and the verb is on screen at every window and every UI zoom.
 */
const WRAP_STYLE: CSSProperties = {
  flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14,
};
/** What gives way: the welcome line, the board and the note, in the order they are read. No
 *  standing `scrollbar-gutter`: this scroller sits inside the job zone's own, so a reserved gutter
 *  here stacked with the zone's into a doubled right inset (the rule and the measurements are at
 *  `PanelShell.tsx`'s job zone). */
const SCROLL_STYLE: CSSProperties = {
  flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
  display: 'flex', flexDirection: 'column', gap: 14,
  scrollbarWidth: 'thin',
};
/**
 * `overflow: hidden` clips the transient geometry the rotation draws over the box — the departing
 * ghost overlaid on the standing rows, the incoming row's entrance travel — and stands backstop for
 * the one frame between a wrap change and the ruler's re-measure.
 *
 * `flexShrink: 0` is what keeps that clip from cutting into the REAL rows. `overflow` other than
 * `visible` also drops a flex item's automatic minimum size to 0 (the box would otherwise resist
 * shrinking below its content), so without this a cramped record zone squeezed the box itself down
 * past its own three rows' combined height and `overflow: hidden` clipped the tail of real content
 * that the ancestor scroller (`dream-scroll`) exists to hold instead.
 */
const ROWS_STYLE: CSSProperties = {
  position: 'relative', display: 'flex', flexDirection: 'column', gap: ROW_GAP,
  overflow: 'hidden', flexShrink: 0,
};

/**
 * THE RULER'S OWN CLIP BOX. The stack inside sizes itself to the WHOLE pool (every order, unclamped)
 * so it can measure each one, which is taller than the reserve always — and an absolutely positioned
 * descendant's box counts toward its scrolling ancestor's scrollable overflow regardless of its own
 * visibility, so the bare stack left `dream-rows` reporting a full pool of scrollHeight (measured
 * live: 303 against a 201 box) that nothing on screen ever shows. A zero-height overflow-hidden box
 * contributes nothing itself and clips its descendants out of the board's accounting, while the
 * stack inside still lays out, at the rows' own width (`left`/`right` 0), for the observer to read.
 *
 * `visibility: hidden` rather than `display: none`, because a display-none box has no layout to read.
 */
const MEASURE_CLIP_STYLE: CSSProperties = {
  position: 'absolute', left: 0, right: 0, top: 0, height: 0,
  overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none',
};

/**
 * THE BOARD RESERVES THE TALLEST TRIO IT CAN EVER SHOW, and this is the stack it measures to find
 * out what that is: every order in the pool, laid out at the board's own width, out of the flow so
 * it costs the visible rows nothing.
 *
 * WHY IT HAS TO BE MEASURED. A slip's height is its own two lines of text wrapped at the panel's
 * width, so it differs per order AND per locale: one rotation's three-row windows span tens of px
 * between the lightest and heaviest trio in English, more in Russian, while Thai fits every slip on
 * one line and never moves. Each slip stands at its OWN natural height (a shared clamp across the
 * three shown rows reads as three boxes forced to the tallest one's size), so the reserve is the
 * tallest WINDOW of the rotation (`boardHeight`) rather than one height times SHOWN, and a lighter
 * trio leaves the slack as empty room under it rather than moving the board. Nothing here can be
 * computed: it is what the font, the locale and the wrap actually did.
 */
const MEASURE_STYLE: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: ROW_GAP,
};

/**
 * THE RULER'S UNIT PROBE, in css px. Every rect the ruler reads answers in screen px — the frame's
 * css zoom and the UI zoom both multiply into `getBoundingClientRect` — while the reserve is written
 * back as a css `height` inside those same zooms, so a rect taken for a css px reserves zoom-times
 * the room: too tall above 1, CLIPPING the trio's last lines below it (measured live: 204 css px
 * reserved against a 216 css px trio at zoom .864). A box declared at this width and measured gives
 * the exact factor to divide back out, whatever stack of zooms produced it.
 */
const SCALE_PROBE_W = 96;

const ROW_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%', boxSizing: 'border-box',
  background: INSET, borderRadius: 12, padding: 8, textAlign: 'left',
};

const SHOT_STYLE: CSSProperties = {
  position: 'relative', flex: '0 0 auto', width: THUMB.width, height: THUMB.height,
  borderRadius: 8, overflow: 'hidden', border: edge, background: colors.surfaceSecondary,
};

/** Which order the plume is dreaming at cycle `b`: not the row that just arrived, so the badge and
 *  the board are never saying the same thing at the same instant (the artifact's own `dreamOrd`). */
const dreamingAt = (b: number): number => (b === 0 ? 0 : (b + 2) % DREAMS.length);

/** How long a stir waits before another pointer pass can raise one. */
const STIR_GAP_MS = 1500;

/**
 * THE BOARD'S FIXED RESERVE: the tallest COMBINED height any window the rotation actually shows can
 * ever reach. The shown trio is SHOWN consecutive orders of the pool in a cycle, so that is the
 * tallest CYCLIC WINDOW summed, plus the gaps between its rows — not the pool's SHOWN tallest slips
 * from anywhere (three tall slips that never stand together would buy room no real trio uses) and
 * not one height times SHOWN (the uniform clamp). Returns 0 while fewer than SHOWN slips have been
 * measured, which is what tells the caller to reserve nothing rather than to reserve zero.
 */
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

/**
 * EVERY ORDER'S OWN NATURAL HEIGHT IN CSS PX, measured. Returns an empty array while nothing has
 * been measured yet (a first render, or a layout-free environment).
 *
 * IT KEEPS WATCHING. The answer moves with the locale, the panel's width and the moment the real
 * typeface lands — all three change a wrap — so the stack is observed rather than read once, and the
 * array it produces is committed only when it actually changes. A zoom change alone moves nothing:
 * css heights are zoom-invariant, and dividing by the probe is what keeps the reading so.
 */
function usePoolRowHeights(
  stack: RefObject<HTMLDivElement | null>,
  probe: RefObject<HTMLDivElement | null>,
): number[] {
  const [heights, setHeights] = useState<number[]>([]);
  useLayoutEffect(() => {
    const el = stack.current;
    if (!el) return undefined;
    const measure = (): void => {
      // The probe divides the rects' screen px back into css px (its own doc, above). A probe that
      // measures 0 has no layout to report (jsdom), where the rects answer 0 too and 1 divides true.
      const probeW = probe.current?.getBoundingClientRect().width ?? 0;
      const scale = probeW > 0 ? probeW / SCALE_PROBE_W : 1;
      // Rounded UP to whole px: a fractional reserve leaves the browser rounding the container one
      // way and the row the other, which is the same one-pixel wobble the reserve exists to stop.
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
  /**
   * THE PANEL IS DOCKED, so the board takes the room that exists: the whole pool stands at its own
   * natural height, and the queue has nothing left to reveal — no rotation, no departing ghost, no
   * reserve and no ruler. The plume keeps dreaming through the pool either way; a board that went on
   * paging three slips left hundreds of px of empty cream under the window it was rationing for.
   */
  pinned?: boolean;
}) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const [beat, setBeat] = useState(0);
  const stirredAt = useRef(0);
  /**
   * THE ROW THAT JUST LEFT THE BOARD (`dreamEngine.rotateOnce`'s ghost). The three shown rows are a
   * plain derivation of `beat`, so the departing one is never IN that list to animate on its own way
   * out — it is held here instead, as an overlay for exactly `DREAM.rowOut`'s own duration, while the
   * two survivors glide up under it (`rowGlide`) and the new one lands after them.
   */
  const [leaving, setLeaving] = useState<typeof DREAMS[number] | null>(null);
  const prevBeatRef = useRef(0);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /**
   * THE ROWS' PICTURE IS THE OPEN MAP, and the grid is mutated in place: without a version the first
   * capture would stand for the island's whole life. Read at whatever render happens rather than
   * subscribed to (nothing here re-renders per command), so an edit reaches the board at the next
   * beat and a burst of them costs one capture, not one per command.
   */
  const grid = useEditorStore((s) => s.gridState);
  const mapVersion = `${grid?.cellsVersion ?? 0}:${grid?.objectsVersion ?? 0}`;
  /**
   * EACH SLIP STANDS AT ITS OWN HEIGHT; the board's height does not. `reserve` is the tallest a
   * 3-candidate window of the rotation can ever add up to, so a rotation that brings in a lighter
   * combination leaves the difference as empty room under the rows rather than shrinking the board.
   */
  const measureRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const poolHeights = usePoolRowHeights(measureRef, probeRef);
  const reserve = boardHeight(poolHeights);

  /**
   * THE ONE LOOP, and it owns the plume for as long as this screen stands. The cleanup puts the
   * plume away whichever way the screen leaves (Connect, a key arriving, the panel folding), so the
   * character cannot be left dreaming over a connected desk.
   */
  useEffect(() => {
    setDreamBadge('zzz');
    if (reduced) {
      // The complete still: the board standing, the plume wearing the first order's glyph.
      setDreamBadge(DREAMS[dreamingAt(0)]!.icon);
      return () => { setDreamBadge('off'); };
    }
    const t0 = performance.now();
    let frame = 0;
    let at = -1;
    let twitched = false;
    let resettled = false;
    // Composited onto the sleeping pose rather than replacing it: the sleep is a fill the pose
    // machine holds, and a one-shot that wrote the transform outright would take it away.
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
      // SHE RESETTLES EVERY SECOND CYCLE, inside the hold: a sleeper who never moves reads as a still
      // image of one, and the beat sheet spaces it so it is not a performance either.
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

  /**
   * THE ROW THAT JUST LEFT (`dreamEngine.rotateOnce`'s ghost fade). A plain effect off `beat` rather
   * than folded into the loop above: the loop's own tick fires every frame and would replay the same
   * departure on every one of them, where this runs exactly once per beat, on the render it changed.
   */
  useEffect(() => {
    // A standing pool turns nothing over, so no row ever leaves it.
    if (reduced || pinned) return undefined;
    const prev = prevBeatRef.current;
    prevBeatRef.current = beat;
    if (beat === prev) return undefined;
    setLeaving(DREAMS[prev % DREAMS.length]!);
    leaveTimerRef.current = setTimeout(() => setLeaving(null), DREAM.rowOut.dur);
    return () => clearTimeout(leaveTimerRef.current);
  }, [beat, reduced, pinned]);

  /**
   * THE TWO ROWS THAT SURVIVE A BEAT GLIDE INTO THE PLACES THAT OPENED UP, and it is a FLIP: their
   * boxes are read every beat, and a row whose box has moved animates from where it was back to
   * where it now is. Without it the board's rotation is two rows teleporting up one slot while a
   * ghost of the departed one fades over the top of them, which is the artifact's `rotateOnce` minus
   * the only part of it that carries the move.
   *
   * A LAYOUT EFFECT, because the reading has to be taken before the browser paints the new places:
   * a passive effect leaves one frame of the rows already standing where they landed.
   */
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const wasAt = useRef(new Map<string, number>());
  const glideRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowEls.current.set(id, el);
    else rowEls.current.delete(id);
  }, []);
  useLayoutEffect(() => {
    const now = new Map<string, number>();
    for (const [id, el] of rowEls.current) {
      const top = el.getBoundingClientRect().top;
      now.set(id, top);
      const before = wasAt.current.get(id);
      if (reduced || before === undefined || Math.abs(before - top) < 0.5) continue;
      if (typeof el.animate !== 'function') continue;
      el.animate(
        [{ transform: `translateY(${before - top}px)` }, { transform: 'none' }],
        { duration: DREAM.rowGlide.dur, easing: DREAM.rowGlide.easing, fill: 'none' },
      );
    }
    wasAt.current = now;
  }, [beat, reduced]);

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
    <div data-testid="dream-office" style={WRAP_STYLE}>
      <div data-testid="dream-scroll" style={SCROLL_STYLE}>
        <p style={{ ...roleFont('label'), fontFamily: font.family, color: PLATE_INK, lineHeight: 1.5, margin: 0 }}>
          {t('agent3.dream_say')}
        </p>
        <div
          data-testid="dream-rows"
          onPointerMove={stir}
          // Docked, every slip in the pool is standing, so the box is its own content and there is
          // nothing for a reserve to steady or a ruler to measure.
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
          {leaving && <DepartingRow order={leaving} mapVersion={mapVersion} />}
          {(pinned
            ? DREAMS
            : Array.from({ length: SHOWN }, (_, i) => DREAMS[(beat + i) % DREAMS.length]!)
          ).map((order) => (
            <DreamRow
              key={order.id}
              order={order}
              reduced={reduced}
              mapVersion={mapVersion}
              glideRef={glideRef}
            />
          ))}
        </div>
        <p style={{ ...roleFont('note'), fontFamily: font.family, color: colors.brownText, lineHeight: 1.45, margin: 0, padding: '0 3px' }}>
          {t('agent3.dream_note')}
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
    </div>
  );
}

type DreamOrder = { id: string; icon: IconId; titleKey: string; subKey: string };

/** The picture and the two lines, shared by the standing row, the one on its way out and the ones
 *  being measured: they differ only in how they arrive and leave, never in what they show. With no
 *  `mapVersion` the thumb stands as its own empty box, which is the measuring case. */
function RowContent({ order, mapVersion }: { order: DreamOrder; mapVersion?: string }) {
  const t = useT();
  return (
    <>
      <span style={SHOT_STYLE}>
        {mapVersion !== undefined && (
          <MapShot
            box={undefined}
            width={THUMB.width}
            height={THUMB.height}
            whole
            version={mapVersion}
            placeholder={(
              <span style={{
                display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', color: INK,
              }}
              >
                <Icon id={order.icon} size={16} />
              </span>
            )}
          />
        )}
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

/**
 * One inert slip on the board. It arrives with the queue and does nothing else.
 *
 * IT LANDS AFTER THE BOARD HAS MOVED, which is what the delay is: the two rows above it are gliding
 * up into the departed row's place for `rowGlide`, and a new row fading in on top of that move reads
 * as three things happening at once. `fill: 'backwards'` is what holds it invisible through the
 * delay rather than showing it fully formed and then animating it in.
 */
function DreamRow({ order, reduced, mapVersion, glideRef }: {
  order: DreamOrder;
  reduced: boolean;
  mapVersion: string;
  /** The board's own FLIP register: it reads every standing row's place, so the ones that survive a
   *  beat can glide from where they were to where they now are. */
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
      <RowContent order={order} mapVersion={mapVersion} />
    </div>
  );
}

/**
 * THE ROW THAT JUST LEFT (`dreamEngine.rotateOnce`'s ghost). Laid absolutely over the standing rows
 * for exactly `DREAM.rowOut`'s own duration, fading and drifting away while the three underneath
 * have already taken their new places beneath it — the same beat the artifact's ghost row plays,
 * minus the live layout re-measurement a fixed three-row window has no need of.
 */
function DepartingRow({ order, mapVersion }: { order: DreamOrder; mapVersion: string }) {
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
      <RowContent order={order} mapVersion={mapVersion} />
    </div>
  );
}

/**
 * ONE SLIP, LAID OUT TO BE MEASURED AND NOTHING ELSE. Same content in the same box as a standing row,
 * so the height it reports is the height that row would have; what it leaves out is the PICTURE,
 * which is a live capture of the open map and would cost one per order in the pool for a reading the
 * thumb's own fixed box already gives.
 */
function MeasureRow({ order }: { order: DreamOrder }) {
  return (
    <div style={ROW_STYLE}>
      <RowContent order={order} />
    </div>
  );
}
