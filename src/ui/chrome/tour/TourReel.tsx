/**
 * A card's reel: the clip, one bar per segment under it (pressing one plays from there) and the
 * caption of the segment playing. The bars fill with the clip's own time, written each frame past
 * React, gliding only to a part pressed; the caption changes only when the segment does. The clip's
 * rounded frame stands still while a crossing slides its picture, bars and caption past it. Under
 * reduced motion or while the browser saves data the clip rests on its poster until asked; a clip
 * that cannot play stands as its poster, and the card around it works the same. Opened under the
 * splash, the clip waits on its start until the splash lifts. Where the window could show the clip
 * notably larger, a press on it enlarges the whole reel over the window and another puts it back,
 * the clip playing on throughout.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { motion, useIsPresent, useReducedMotionConfig } from 'framer-motion';
import { followToward, frameDt, framerMotion } from '../../design/motion';
import { useReadingT } from '../../design/reading';
import { useInteractionProfiles, useTouchMode } from '../../design/input-mode';
import { TOUCH_TARGET } from '../../design/scale-model';
import { useViewportSize } from '../../design/scale';
import { cursors, font, radii, z } from '../../design/styles';
import { OVERLAY_DIM } from '../../design/tokens';
import { TEXT_ROLES } from '../../design/text-weight';
import { visualRect } from '../../design/visual-rect';
import { skin, WINDOW_ICON_BUTTON } from '../../design/window-skin';
import { ActionButton } from '../../primitives/ActionButton';
import { useGlidingChromeLift } from '../../primitives/chrome-layer';
import { FitIcon, ShrinkIcon } from '../../primitives/line-glyphs';
import { LoopVideo, type LoopVideoHandle } from '../../primitives/LoopVideo';
import { MORPH_PIECE_ATTR, MORPH_SHAPE_ATTR, morphScope, useMorphPresence, type MorphFirst, type MorphRun, type MorphShape } from '../../primitives/morph';
import { MorphOnChange } from '../../primitives/MorphOnChange';
import { useSurfaceScope } from '../../primitives/surface-scope';
import { useNameReveal } from '../../primitives/use-name-reveal';
import { useObservedSize } from '../../primitives/use-observed-size';
import { asksToSaveData } from '../../../platform/device/device-quality';
import { useHandoffCovered } from '../../session/splash-handoff';
import { helpTargetAttr } from '../../session/help-targets';
import { REEL_CAPTIONS, REEL_TYPES, reelTiming, type ReelFiles, type ReelTiming } from './reels';
import { SWIPE_VAR } from './use-swipe-turn';

const BAR_H = 4;
/** The bar's pressable height around its drawn line. */
const BAR_HIT = 18;
/** The least width an upright sheet gives the bars and the caption under its clip, in card px. */
const CENTRED_SPAN = 240;
/** A bar's drawn share this near its target lands on it, well under a pixel on any bar. */
const SHARE_REST = 0.0005;

/** The share of the frame's shorter side its corners round by, so they take the same part of the
 *  picture at any frame size: the desktop mouse frame, 280 px tall, rounds at `radii.lg`. */
const REEL_RADIUS_SHARE = radii.lg / 280;

/** The corner radius of a `w` by `h` reel frame, in the card's px. */
export function reelRadius(w: number, h: number): number {
  return Math.min(w, h) * REEL_RADIUS_SHARE;
}

/** The corner mark saying a press enlarges the clip: a tab of the card's plate cut into the frame's
 *  inline-end top corner, so it reads as the frame's and never as one of the recording's buttons. Its
 *  least side, how far it reaches past the frame's corner rounding, and its glyph's size, in card px. */
const TAB_LEAST = 26;
const TAB_BEYOND = 12;
const TAB_GLYPH = 16;

/** The corner tab's side on a frame rounded by `radius`: it takes the whole rounded corner, so the
 *  frame's outline runs on along its outer edges. */
function reelTab(radius: number): number {
  return Math.max(TAB_LEAST, radius + TAB_BEYOND);
}

/** The caption's role, set at its nominal weight in every form and at every size: a surface's adapted
 *  weight follows its zoom, which differs between input modes and shapes (`label` stood bold on a
 *  touch screen and medium on a desktop), and `body`'s medium reads at any size the reel is drawn at. */
const CAPTION = TEXT_ROLES.body;

/** The gap between the clip, the bars and the caption, in card px. */
const COLUMN_GAP = 6;
/** The most an enlarged reel's bars and caption grow over their size in the card, so a 14 px caption
 *  stands at 21 px however large the clip, and the most its corner tab and glyph grow. */
const FOOT_MOST = 1.5;
const TAB_MOST = 1.75;

/** How an enlarged reel's parts grow over their size in the card, for a frame drawn `k` times wider at
 *  `zoom` with corner radius `radius` in the card: the bars and caption by `foot`, and the corner tab
 *  and its glyph by `tab`, which in touch mode keeps the tab at least `least` window px across. */
function enlargedScales(k: number, zoom: number, radius: number, least = 0): { foot: number; tab: number } {
  return { foot: Math.min(k, FOOT_MOST), tab: Math.max(Math.min(k, TAB_MOST), least / (reelTab(radius) * zoom)) };
}

/** An enlarged reel's least margin from the window's edges and its plate's padding round it, in card px. */
const ENLARGED_MARGIN = 16;
const ENLARGED_PAD = 12;
/** The room under a clip for the bars and one line of caption, in card px before an enlarged foot's scale. */
const ENLARGED_FOOT = COLUMN_GAP + BAR_HIT + COLUMN_GAP + Math.ceil(CAPTION.px * 1.35);
/** The share of the window's width and height an enlarged reel's plate stands within: the reel only
 *  needs to read well, not to fill the window. */
const ENLARGED_SHARE = 0.8;
/** The shorter side, in window px, an enlarged clip keeps where the window's share would leave it less,
 *  as far as the margin allows. */
const ENLARGED_READABLE = 240;
/** Enlarging is offered only where it shows the clip at least this many times larger. */
const ENLARGE_GAIN = 1.25;

type Size = { w: number; h: number };

/**
 * The clip's size enlarged, in card px, for a `view` window drawn at `zoom`: at the recorded frame's
 * proportions, never larger than it was recorded, its plate (with the bars and caption under the clip,
 * grown by `enlargedScales`' foot) within `ENLARGED_SHARE` of the window, though never shorter on its
 * shorter side than `ENLARGED_READABLE` where the window holds that inside its margin. Null where that would not show a
 * frame of `shown` card px at least `ENLARGE_GAIN` times larger.
 */
export function reelEnlargement(view: Size, zoom: number, shown: Size, recorded: Size): Size | null {
  const aspect = recorded.w / recorded.h;
  const pad = 2 * ENLARGED_PAD;
  // The widest clip a room of `w` by `h` card px holds with its plate, its foot growing with the clip
  // as far as `FOOT_MOST`.
  const within = (w: number, h: number) => {
    const grown = ((h - pad) * aspect) / (1 + (ENLARGED_FOOT * aspect) / shown.w);
    const tall = grown / shown.w <= FOOT_MOST ? grown : (h - pad - ENLARGED_FOOT * FOOT_MOST) * aspect;
    return Math.min(w - pad, tall);
  };
  const room = { w: view.w / zoom, h: view.h / zoom };
  const fit = within(room.w - 2 * ENLARGED_MARGIN, room.h - 2 * ENLARGED_MARGIN);
  const share = within(room.w * ENLARGED_SHARE, room.h * ENLARGED_SHARE);
  const readable = (ENLARGED_READABLE / zoom) * Math.max(1, aspect);
  const w = Math.min(recorded.w / zoom, fit, Math.max(share, readable));
  if (w < shown.w * ENLARGE_GAIN) return null;
  return { w, h: w / aspect };
}

/** The CSS variable a crossing sets on the reel's part to slide what its frame shows, in card px; a
 *  swipe's follow (`use-swipe-turn.ts:SWIPE_VAR`) adds to it. */
export const REEL_SLIDE_VAR = '--tour-reel-slide';
const slid: CSSProperties = { transform: `translateX(calc(var(${REEL_SLIDE_VAR}, 0px) + var(${SWIPE_VAR}, 0px)))` };

/** Where in its segment a clip at `t` seconds stands: 0 before it, 1 past it. */
function shareOf(timing: ReelTiming, i: number, t: number): number {
  const start = timing.segs[i]![1];
  const end = timing.segs[i + 1]?.[1] ?? timing.end;
  return t >= end ? 1 : t <= start ? 0 : (t - start) / (end - start);
}

/** The segment playing at `t`. */
function segmentAt(timing: ReelTiming, t: number): number {
  let at = 0;
  timing.segs.forEach(([, start], i) => { if (t >= start) at = i; });
  return at;
}

/** Where the reel's column stands on the window while it is out of its card at its usual size: its
 *  top left corner in window px and its width in card px. */
type Slot = { left: number; top: number; width: number };

/** Where an enlargeable reel stands out of its card: lifted onto the window at its usual size over its
 *  place (`lift`, for the one commit before it grows), enlarged (`out`, growing or at rest) or
 *  shrinking back over its place (`back`), with the room its bars and caption take under the clip in
 *  the card (`foot`) and, once measured, enlarged (`grown`), and the caption's height and width in the
 *  card (`caption`, `span`), in card px. */
type Enlarged = { files: ReelFiles; phase: 'lift' | 'out' | 'back'; at: Slot; foot: number; caption: number; span: number; grown?: number };

/** The caption's look at a foot grown `foot` times. */
const captionText = (foot: number, centred: boolean): CSSProperties => ({
  fontSize: CAPTION.px * foot, fontWeight: CAPTION.weight, color: skin.plateInk, minHeight: '1.35em', lineHeight: 1.35, textAlign: centred ? 'center' : 'start',
  // Narrower than the column on a plate, it keeps to the clip's leading edge unless it centres.
  alignSelf: centred ? 'center' : 'flex-start',
});

/** The enlarged caption's width for one `span` card px wide in the card, on a clip `w` card px wide:
 *  its card width grown with its type, so it wraps as it did in the card and the glide carries it
 *  within its card box, unless that is wider than the clip. */
const enlargedSpan = (span: number, foot: number, w: number): number => Math.min(span * foot, w);

/**
 * How far the enlarged plate shrinks to stand over a reel in its card (lifting off, or landing back):
 * at its own proportions, so the morph scales it evenly, the least that still holds, inside its
 * shrunk padding, the card's `frame`, the `foot` under it and the `span` its bars and caption take,
 * for a clip enlarged to `enlarged` on a plate `plate` padded by `ENLARGED_PAD`, all in card px.
 * Holding every part at both ends of the glide, it holds them all through it.
 */
function liftedPlateShrink(frame: Size, foot: number, span: number, enlarged: Size, plate: Size): number {
  return Math.max(frame.w / enlarged.w, span / enlarged.w, (frame.h + foot) / (plate.h - 2 * ENLARGED_PAD));
}

/** What a part the enlargement carries wears (`morphScope`), with its `MorphShape`. */
const piece = (id: string, shape?: MorphShape) => ({ [MORPH_PIECE_ATTR]: id, ...(shape ? { [MORPH_SHAPE_ATTR]: shape } : {}) });

export function TourReel({ files, width, height, centred, enlarge = null, onPlaying }: {
  files: ReelFiles | null;
  /** The clip's frame, in the card's px. */
  width: number;
  height: number;
  /** The caption centres under the clip (the upright sheet) rather than starting at its left. */
  centred: boolean;
  /** The clip's enlarged size in card px (`reelEnlargement`), where a press on it enlarges it. */
  enlarge?: { w: number; h: number } | null;
  onPlaying?: () => void;
}) {
  const t = useReadingT();
  const clip = useRef<LoopVideoHandle>(null);
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  /** Each bar's drawn share, which follows its share of the clip's time. */
  const drawn = useRef<number[]>([]);
  /** A part was pressed and the bars are gliding to it; otherwise they stand at the clip's time. */
  const seeking = useRef(false);
  const reduced = useReducedMotionConfig() === true;
  const [timing, setTiming] = useState<ReelTiming | null>(null);
  const [at, setAt] = useState(0);
  const [held] = useState(asksToSaveData);
  // Under the splash the clip waits on its start, so the reader first sees it begin.
  const covered = useHandoffCovered();
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let live = true;
    setTiming(null);
    setAt(0);
    drawn.current = [];
    seeking.current = false;
    setPlaying(false);
    if (files) void reelTiming(files).then((next) => { if (live) setTiming(next); });
    return () => { live = false; };
  }, [files]);

  // One read of the clip's time per frame while it plays; a clip resting on its poster reads nothing.
  // The bars stand at the time, so the loop's restart empties them all at once; only after a part is
  // pressed do they glide to it, together, until every bar lands. Under reduced motion they never glide.
  useEffect(() => {
    if (!timing || !playing) return undefined;
    let frame = 0;
    let shown = -1;
    let last: number | undefined;
    const read = (now: number): void => {
      const v = clip.current?.video();
      if (v) {
        const time = v.currentTime;
        const dt = frameDt(last, now);
        const glide = seeking.current && !reduced;
        let landed = true;
        timing.segs.forEach((_, i) => {
          const el = fills.current[i];
          if (!el) return;
          const target = shareOf(timing, i, time);
          const was = drawn.current[i] ?? target;
          const next = glide ? followToward(was, target, dt, 'tour.reel.seek') : target;
          drawn.current[i] = Math.abs(next - target) < SHARE_REST ? target : next;
          if (drawn.current[i] !== target) landed = false;
          el.style.width = `${drawn.current[i]! * 100}%`;
        });
        if (landed) seeking.current = false;
        const seg = segmentAt(timing, time);
        if (seg !== shown) { shown = seg; setAt(seg); }
      }
      last = now;
      frame = requestAnimationFrame(read);
    };
    frame = requestAnimationFrame(read);
    return () => cancelAnimationFrame(frame);
  }, [timing, playing, reduced]);

  const sources = files ? [
    ...(files.webm ? [{ src: files.webm, type: REEL_TYPES.webm }] : []),
    ...(files.mp4 ? [{ src: files.mp4, type: REEL_TYPES.mp4 }] : []),
  ] : [];
  const reelKey = sources[0]?.src ?? files?.poster ?? files?.kind ?? '';
  // A switch that brings the other form's clip fades the old one out and the new one in, in place
  // inside the frame, on the switch's own motion.
  const presence = useMorphPresence(`tour-reel:${reelKey}`);

  const present = useIsPresent();
  const touch = useTouchMode();
  const { zoom, weights } = useGlidingChromeLift(WINDOW_ICON_BUTTON);
  const view = useViewportSize();
  const profiles = useInteractionProfiles();
  const [enlarged, setEnlarged] = useState<Enlarged | null>(null);
  // An enlargement stands for the clip it began on, while it is offered and the reel is the card's:
  // another form's clip, a window that no longer offers it, or a card leaving puts it back at once.
  const live = enlarged && files && enlarged.files === files && enlarge && present ? enlarged : null;
  if (enlarged && !live) setEnlarged(null);
  const big = live?.phase === 'out' && enlarge ? enlarge : null;
  // The reel's parts render into one element that moves between its place in the card and the
  // window's layer, so the clip keeps its element, its time and its play across the move. It moves
  // only where both places lay it out alike: onto the window at its usual size over its place, and
  // back once it stands there again; the layer's morph carries it between that size and the enlarged one.
  const [host] = useState(() => document.createElement('div'));
  const homeRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const standInRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [morph] = useState(morphScope);
  /** The newest pass of the glide, so only a shrink no later press turned round puts the reel back. */
  const pass = useRef<MorphRun | null>(null);
  /** The reel held focus as it was put back, before its layer left the page. */
  const refocus = useRef(false);
  useLayoutEffect(() => {
    const into = live ? slotRef.current : homeRef.current;
    if (!into) return;
    if (host.parentElement !== into) {
      // A move takes focus off the element moved; the toggle takes it back, and takes it on enlarging.
      const focused = host.contains(document.activeElement) || refocus.current;
      refocus.current = false;
      into.appendChild(host);
      if (focused || live) toggleRef.current?.focus({ preventScroll: true });
    }
  });
  // Lifted, it grows in the next commit, which the layer's morph measures from here.
  // Its grown foot is first read off the caption laid out unseen at the enlarged size, so the plate lifts
  // off at the enlarged plate's proportions, all before the frame paints.
  const captionProbe = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (live?.phase !== 'lift') return;
    const probe = captionProbe.current;
    if (live.grown === undefined && probe && enlarge) {
      const { foot } = enlargedScales(enlarge.w / width, zoom, reelRadius(width, height));
      setEnlarged({ ...live, grown: (live.foot - live.caption) * foot + probe.offsetHeight });
    } else {
      setEnlarged({ ...live, phase: 'out' });
    }
  }, [live, enlarge, width, height, zoom]);
  useEffect(() => () => host.remove(), [host]);

  const putBack = (): void => {
    refocus.current = host.contains(document.activeElement);
    setEnlarged(null);
  };
  /** Where a column-wide element in the card stands on the window. */
  const slotOf = (el: HTMLElement): Slot => { const r = visualRect(el); return { left: r.left, top: r.top, width: el.offsetWidth }; };
  const restore = (): void => {
    if (!live || live.phase === 'back') return;
    const home = standInRef.current;
    if (reduced || !home) { putBack(); return; }
    setEnlarged({ ...live, phase: 'back', at: slotOf(home) });
  };
  const toggle = (): void => {
    if (live?.phase === 'back') { setEnlarged({ ...live, phase: 'out' }); return; }
    if (live) { restore(); return; }
    const column = columnRef.current;
    const frame = column?.firstElementChild as HTMLElement | null | undefined;
    if (!files || !column || !frame) return;
    const said = column.lastElementChild as HTMLElement | null;
    setEnlarged({
      files, phase: reduced ? 'out' : 'lift', at: slotOf(column), foot: column.offsetHeight - frame.offsetHeight,
      caption: said?.offsetHeight ?? 0, span: said?.offsetWidth ?? width,
    });
  };
  const measureGlide = (): MorphFirst | null => (reduced || !layerRef.current ? null : morph.measure(layerRef.current));
  const playGlide = (first: MorphFirst): void => {
    const run = morph.play(first, 'tour.reel.enlarge');
    pass.current = run;
    // A shrink ends on the reel's place, where the card takes it back.
    void run.settled.then(() => { if (pass.current === run && phaseRef.current === 'back') putBack(); });
  };
  const phaseRef = useRef<Enlarged['phase'] | null>(null);
  phaseRef.current = live?.phase ?? null;
  // The enlarged foot's height, read as it lays out (a long caption wraps onto more lines), so the plate holds it.
  useObservedSize(() => (live?.phase === 'out' ? columnRef.current : null), () => {
    const column = columnRef.current;
    const frame = column?.firstElementChild as HTMLElement | null | undefined;
    if (!column || !frame || !live) return;
    const grown = column.offsetHeight - frame.offsetHeight;
    if (Math.abs(grown - (live.grown ?? -1)) > 0.5) setEnlarged({ ...live, grown });
  }, [live?.phase, live?.files, enlarge?.w]);
  // Escape puts the enlarged reel back before it reaches the tips.
  /** Whether the reel stands enlarged or is on its way there: what the toggle and its tab say. */
  const opened = !!live && live.phase !== 'back';
  useSurfaceScope({ open: opened, onClose: restore, root: layerRef, trigger: toggleRef, focus: 'contain' });
  const name = useNameReveal(t(opened ? 'tour.reel_restore' : 'tour.reel_enlarge'));

  if (!files) return null;
  const captions = REEL_CAPTIONS[files.kind];
  const captionOf = (seg: string): string => { const key = captions[seg]; return key ? t(key) : ''; };
  const segs = timing?.segs ?? [];
  const caption = segs[at] ? captionOf(segs[at]![0]) : '';
  const said = [...new Set(segs.map(([id]) => captionOf(id)))];
  const w = big ? big.w : width;
  const h = big ? big.h : height;
  // Enlarged, the frame grows `k` times and its tab, bars and caption with it (`enlargedScales`).
  const home = reelRadius(width, height);
  const k = enlarge ? enlarge.w / width : 1;
  const scales = enlargedScales(k, zoom, home, touch ? TOUCH_TARGET : 0);
  const foot = big ? scales.foot : 1;
  const grow = big ? scales.tab : 1;
  // Centred under an upright sheet's narrow clip, the bars and the caption keep a readable width; on
  // the plate they take the clip's.
  const span = big ? w : centred ? Math.max(w, CENTRED_SPAN) : w;
  const column: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: COLUMN_GAP * foot, width: centred && !big ? '100%' : w, flex: 'none' };
  const radius = reelRadius(w, h);
  const tab = reelTab(home) * grow;
  // Its outer corner rounds no more than the frame's, so the frame's corner never shows past it.
  const tabCorner = home * Math.min(grow, big ? k : 1);
  const carried = !!enlarge;
  const fade = framerMotion('tour.reel.enlarge', reduced);
  const reel = (
    <div ref={columnRef} style={column} data-testid="tour-reel">
      {/* The press feedback scales the frame and its corner tab together, as one control. */}
      <motion.div {...(carried ? profiles.row : null)} data-tour-reel-press style={{ position: 'relative', width: w, height: h, flex: 'none' }}>
        <div {...(carried ? piece('tour-reel-frame') : null)} style={{ position: 'absolute', inset: 0 }}>
          {/* The frame stays put and rounds every frame of a crossing; only the picture inside it slides. */}
          <div style={{ position: 'relative', width: w, height: h, borderRadius: radius }}>
            {/* Under the picture, which lets presses through to it, so its focus ring stands clear of the frame. */}
            {enlarge && (
              <ActionButton
                ref={toggleRef}
                interaction="still"
                aria-label={t(opened ? 'tour.reel_restore' : 'tour.reel_enlarge')}
                aria-expanded={opened}
                {...name.bind}
                onClick={toggle}
                data-testid="tour-reel-enlarge"
                {...helpTargetAttr('tour', 'tour-reel')}
                style={{ position: 'absolute', inset: 0, padding: 0, border: 'none', borderRadius: radius, background: 'transparent', cursor: cursors.clickable }}
              >{name.bubble}</ActionButton>
            )}
            <div style={{ position: 'relative', width: w, height: h, borderRadius: radius, overflow: 'hidden', isolation: 'isolate', background: skin.inset, pointerEvents: enlarge ? 'none' : undefined }}>
              <div key={reelKey} {...presence} style={{ width: w, height: h }}>
                <LoopVideo
                  ref={clip}
                  sources={sources}
                  poster={files.poster}
                  posterAtRest
                  label={caption || t('tour.reel_label')}
                  playLabel={t('tour.reel_play')}
                  autoplay={!held}
                  waiting={covered}
                  onPlaying={() => { setPlaying(true); onPlaying?.(); }}
                  onPause={() => setPlaying(false)}
                  testId="tour-reel-clip"
                  style={{ width: w, height: h, background: skin.inset, ...slid }}
                />
              </div>
            </div>
          </div>
        </div>
        {enlarge && (
          <span aria-hidden data-testid="tour-reel-tab" {...piece('tour-reel-tab')} style={{
            position: 'absolute', top: 0, insetInlineEnd: 0, width: tab, height: tab, background: skin.plate, color: skin.plateInk,
            borderStartEndRadius: tabCorner, borderEndStartRadius: tab / 2, pointerEvents: 'none',
          }}>
            <motion.span initial={false} animate={{ opacity: opened ? 0 : 1 }} transition={fade} style={tabGlyph}>
              <FitIcon size={TAB_GLYPH * grow} />
            </motion.span>
            <motion.span initial={false} animate={{ opacity: opened ? 1 : 0 }} transition={fade} style={tabGlyph}>
              <ShrinkIcon size={TAB_GLYPH * grow} />
            </motion.span>
          </span>
        )}
      </motion.div>
      {/* The bars' row keeps its place while the timing loads, so the card does not shrink and grow back. */}
      {segs.length === 0 && files.timing && <div aria-hidden style={{ height: BAR_HIT * foot, flex: 'none' }} />}
      {segs.length > 0 && (
        <div role="group" aria-label={t('tour.reel_parts')} {...(carried ? piece('tour-reel-bars', 'fill') : null)} style={{ display: 'grid', gridTemplateColumns: `repeat(${segs.length}, minmax(0, 1fr))`, gap: 4 * foot, width: span, maxWidth: '100%', ...slid }}>
          {segs.map(([id, start], i) => (
            <ActionButton
              key={id}
              interaction="tile"
              aria-label={captionOf(id) || t('tour.reel_part', { n: i + 1 })}
              aria-current={i === at ? 'step' : undefined}
              onClick={() => { seeking.current = true; clip.current?.playFrom(start); }}
              style={{ height: BAR_HIT * foot, padding: 0, border: 'none', background: 'transparent', cursor: cursors.clickable, display: 'flex', alignItems: 'center' }}
            >
              <span style={{ position: 'relative', display: 'block', width: '100%', height: BAR_H * foot, borderRadius: radii.hair, background: skin.track, overflow: 'hidden' }}>
                <span ref={(el) => { fills.current[i] = el; }} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 0, background: skin.plateInk }} />
              </span>
            </ActionButton>
          ))}
        </div>
      )}
      <div aria-hidden {...(carried ? piece('tour-reel-caption', 'fit') : null)} style={{
        ...captionText(foot, centred), width: big && live ? enlargedSpan(live.span, foot, w) : span, maxWidth: '100%', ...slid,
      }}>
        <CaptionRoom said={said} caption={caption} />
      </div>
    </div>
  );

  // The enlarged plate, centred on the window at the card's zoom, its foot as measured or else as the
  // card's grown, and where the reel's column stands: inside the plate, or over its place in the card as
  // it lifts off and as it shrinks back. There the plate stands at the enlarged plate's proportions,
  // centred on the frame and shrunk as far as still holds the column as the card lays it out (its bars
  // and caption grow less than the frame, and an upright sheet's are wider than it), so the one morph
  // scales it evenly with the reel, its corners too, and every part stands inside it at both ends of
  // the glide and so all through it.
  const grownFoot = live ? live.grown ?? live.foot * scales.foot : 0;
  const plate = enlarge ? { w: enlarge.w + 2 * ENLARGED_PAD, h: enlarge.h + grownFoot + 2 * ENLARGED_PAD } : null;
  // Its top corners round about the frame's; its foot's no more than a window's, which keeps the
  // caption's line a pad in from them clear of their arc (a large frame's would cut its first letter).
  const plateRadius = enlarge ? reelRadius(enlarge.w, enlarge.h) + ENLARGED_PAD : 0;
  const footRadius = Math.min(plateRadius, radii.panel);
  const left = plate ? (view.w - plate.w * zoom) / 2 : 0;
  const top = plate ? (view.h - plate.h * zoom) / 2 : 0;
  const slot: Slot | null = big ? { left: left + ENLARGED_PAD * zoom, top: top + ENLARGED_PAD * zoom, width: big.w } : live ? live.at : null;
  const shrink = live && enlarge && plate ? liftedPlateShrink({ w: width, h: height }, live.foot, live.span, enlarge, plate) : 1;
  const plateAt = big || !live || !plate ? { left, top, shrink: 1 } : {
    left: live.at.left + ((centred ? (live.at.width - width) / 2 : 0) + width / 2) * zoom - (plate.w * shrink * zoom) / 2,
    top: live.at.top - ENLARGED_PAD * shrink * zoom,
    shrink,
  };
  const layer = live && plate && slot ? createPortal(
    <div ref={layerRef} role="dialog" aria-modal="true" aria-label={t('tour.reel_label')} style={{ position: 'fixed', inset: 0, zIndex: z.takeover, fontFamily: font.family }}>
      <MorphOnChange<MorphFirst> change={live.phase} measure={measureGlide} play={playGlide} stop={() => morph.stop()}>
        <motion.div aria-hidden initial={{ opacity: 0 }} animate={{ opacity: live.phase === 'back' ? 0 : 1 }} transition={fade}
          onClick={restore} style={{ position: 'absolute', inset: 0, background: OVERLAY_DIM }} />
        <div style={{ position: 'absolute', left: plateAt.left, top: plateAt.top }}>
          <div onClick={restore} data-testid="tour-reel-plate" {...piece('tour-reel-plate', 'fill')} style={{
            zoom, width: plate.w * plateAt.shrink, height: plate.h * plateAt.shrink, borderRadius: `${plateRadius * plateAt.shrink}px ${plateRadius * plateAt.shrink}px ${footRadius * plateAt.shrink}px ${footRadius * plateAt.shrink}px`, background: skin.plate,
          }} />
        </div>
        <div style={{ position: 'absolute', left: slot.left, top: slot.top }}>
          <div ref={slotRef} style={{ zoom, ...weights, width: slot.width }} />
        </div>
        {live.phase === 'lift' && live.grown === undefined && enlarge && (
          <div aria-hidden style={{ position: 'absolute', left: 0, top: 0, visibility: 'hidden', pointerEvents: 'none', zoom, ...weights }}>
            <div ref={captionProbe} style={{ ...captionText(scales.foot, centred), width: enlargedSpan(live.span, scales.foot, enlarge.w) }}>
              <CaptionRoom said={said} caption={caption} />
            </div>
          </div>
        )}
      </MorphOnChange>
    </div>,
    document.body,
  ) : null;

  return (
    <div style={{ width: centred ? '100%' : width, flex: 'none' }}>
      <div ref={homeRef} style={{ display: 'contents' }} />
      {/* While the reel stands out of its card its place keeps the frame's ground and the room its bars took. */}
      {live && (
        <div ref={standInRef} aria-hidden style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: centred ? '100%' : width, height: height + live.foot }}>
          <div data-tour-reel-stand-in style={{ width, height, borderRadius: reelRadius(width, height), background: skin.inset, flex: 'none' }} />
        </div>
      )}
      {createPortal(reel, host)}
      {layer}
    </div>
  );
}

/** The caption shown, over every caption of its reel standing unseen in the same place, so its box
 *  takes the longest one's room and a change of caption never moves the card or the enlarged plate. */
function CaptionRoom({ said, caption }: { said: readonly string[]; caption: string }) {
  return (
    <div style={{ display: 'grid' }}>
      {said.map((line) => <span key={line} style={{ gridArea: '1 / 1', visibility: 'hidden' }}>{line}</span>)}
      <span style={{ gridArea: '1 / 1' }}>{caption}</span>
    </div>
  );
}

/** One of the corner tab's two glyphs, which cross as the reel enlarges and returns. */
const tabGlyph: CSSProperties = { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' };
