/*
 * Splash.tsx — the boot splash: a small map builds itself tile by tile while the art assets
 * download, then the splash slides away and the app slides into place beneath it.
 *
 * Shown only on a build whose assets have not been fetched once already (`shouldShowSplash`), so
 * a returning visitor goes straight to the editor. Progress is REAL — one tile per slice of the
 * fetch count, the stadium fill tracking the same number — with a floor on the total time so the
 * build reads as construction rather than a flicker.
 *
 * The hand-off is two planes parting: this overlay slides fully up while App's content plane
 * slides its last stretch up into place on the same curve (`splash.handoff`). App owns the
 * content plane's transform; the `onHandoff` callback is the one clock both sides listen to.
 * A transform on the app's root breaks `position: fixed` anchoring for its duration, so this one
 * lives only during the boot hand-off, before any interaction, and ends at `transform: none`.
 *
 * The brand is the README's own masthead SVG, per deployment (the zh art carries the Chinese
 * wordmark); the file embeds its logo, so the lockup is one <img>.
 */
import { useEffect, useState } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { colors, font, z } from '../../design/styles';
import { roleWeight, roleFont } from '../../design/text-weight';
import { MOTIONS } from '../motion/registry';
import { cssMotion, useMotion, useMotionAllowed } from '../motion/use-motion';
import { activeTarget } from '../../../legal/deploy-targets';
import { markSplashDone, preloadAssets } from './preload';
import { useViewportSize } from '../../design/scale';

// The SAME URL the boot loader uses (public/, unhashed): the loader has already downloaded its
// target's masthead by the time this mounts, so the slide-up starts with the art on screen — a
// hashed src/ copy of the same file was a second download, and the banner slid up as alt text
// while it fetched. THE DOMAIN ALONE PICKS THE ART (`deploy-targets.ts:bootBanner`): index.html's
// static loader shows the masthead before any setting can be read, so a splash that then chose by
// locale would swap wordmarks mid-boot on every visitor whose language crosses the domain's.
const BANNER = `${import.meta.env.BASE_URL}${activeTarget().bootBanner}`;

/** The map, in the editor's own palette: s = sand shore, g = grass, m/M = the first two
 *  mountain greens, p = pond. '.' is open ground (no tile). */
const ISLAND = [
  '..ssss.',
  '.sggggs',
  'sgmMggs',
  'sgmgpgs',
  '.sggss.',
];
const COLS = ISLAND[0]!.length;
const HUES: Record<string, string> = {
  s: '#ffe793', g: '#b1e291', m: '#A3D070', M: '#93c956', p: '#97e1ff',
};

interface Tile { x: number; y: number; hue: string; order: number }

/** The tiles in build order: shore first, then inland — the map rises at its rim. */
function islandTiles(): Tile[] {
  const tiles: { x: number; y: number; hue: string }[] = [];
  ISLAND.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') tiles.push({ x, y, hue: HUES[ch]! });
  }));
  const dist = (t: { x: number; y: number }): number => Math.hypot(t.x - 3, (t.y - 2) * 1.4);
  return tiles
    .sort((a, b) => dist(b) - dist(a) || a.x - b.x)
    .map((t, order) => ({ ...t, order }));
}

const TILES = islandTiles();
const TILE_PX = 32;
const TILE_GAP = 3;
/** The floor on the splash's visible time: below it the build reads as a flicker, not a build. */
const MIN_SHOW_MS = 1200;
/** The pause between the map completing and the hand-off. */
const DONE_BEAT_MS = 550;
/** The column's height with breathing room; shorter windows zoom the column down to fit. */
const SPLASH_ROOM = 420;

/** The column's zoom for a window of `viewportH` px, 1 wherever the column fits. */
export function splashFit(viewportH: number): number {
  return Math.min(1, viewportH / SPLASH_ROOM);
}

/** How far below its resting place the banner opens, in the column's own px: the boot loader's
 *  centred banner top (50vh - 63) minus the zoomed column's (50vh - 184 * fit). */
export function bannerTravel(fit: number): number {
  return (184 * fit - 63) / fit;
}

export interface SplashProps {
  /** Fired when the hand-off STARTS — App slides its content plane on the same clock. */
  onHandoff: () => void;
  /** Fired when the hand-off has finished and the overlay may unmount. */
  onDone: () => void;
}

export function Splash({ onHandoff, onDone }: SplashProps) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const plopTransition = useMotion('splash.tile.plop');
  const handoffTransition = useMotion('splash.handoff');
  const [progress, setProgress] = useState(0); // 0..1, fetch-true
  const [leaving, setLeaving] = useState(false);
  // The ARRIVAL: index.html's static boot loader shows this same masthead centred, so the
  // splash's own banner opens at those pixels and slides up to its resting place; the map and
  // the pill fade up once it lands. The offset is arithmetic, not measurement — both layouts are
  // 50vh-centred columns of known heights (boot: banner 86 + gap 28 + dot 12 → banner top at
  // 50vh - 63; splash: banner 86 + gap 34 + map 172 + gap 34 + pill 42 → banner top at
  // 50vh - 184) — so the first painted frame already stands at the start.
  const [phase, setPhase] = useState<'arriving' | 'ready'>('arriving');
  const arriveAllowed = useMotionAllowed('splash.logo.travel');
  const travelTransition = useMotion('splash.logo.travel');
  const fit = splashFit(useViewportSize().h);

  useEffect(() => {
    if (!arriveAllowed) { setPhase('ready'); return; }
    const id = setTimeout(() => setPhase('ready'), MOTIONS['splash.logo.travel'].duration! * 1000);
    return () => clearTimeout(id);
  }, [arriveAllowed]);

  /** The fade the map, the pill and the banner share once the logo has landed. */
  const contentStyle = {
    opacity: phase === 'ready' ? 1 : 0,
    transition: cssMotion('splash.content.fade', 'opacity'),
  } as const;

  useEffect(() => {
    // No once-only ref: the dev StrictMode remount must run its own copy of this chain (the first
    // run's cleanup cancelled it). The preload itself is multiplexed inside preloadAssets, so the
    // network work still happens once.
    const begun = performance.now();
    let cancelled = false;
    const subscription = new AbortController();
    void preloadAssets((done, total) => {
      if (!cancelled) setProgress(total === 0 ? 1 : done / total);
    }, subscription.signal).then(async (complete) => {
      if (complete) markSplashDone();
      if (cancelled) return;
      const wait = (ms: number) => new Promise((r) => { setTimeout(r, ms); });
      await wait(Math.max(0, MIN_SHOW_MS - (performance.now() - begun)));
      await wait(DONE_BEAT_MS);
      if (cancelled) return;
      setLeaving(true);
      onHandoff();
      const handoff = MOTIONS['splash.handoff'];
      await wait(reduced ? 0 : handoff.duration! * 1000);
      if (!cancelled) onDone();
    });
    return () => { cancelled = true; subscription.abort(); };
    // The preload runs once for the component's whole life; reduced/handlers are read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = Math.round(progress * TILES.length);
  const pct = Math.round(progress * 100);

  return (
    <motion.div
      data-testid="boot-splash"
      initial={false}
      animate={leaving ? { y: '-104%' } : { y: 0 }}
      transition={handoffTransition}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: z.splash,
        fontFamily: font.family,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        // The app's cream ground with the editor's own macro grid, barely there. Not a scene.
        background: [
          `repeating-linear-gradient(0deg, transparent 0 33px, rgba(67,65,62,0.05) 33px 34px)`,
          `repeating-linear-gradient(90deg, transparent 0 33px, rgba(67,65,62,0.05) 33px 34px)`,
          colors.panelCream,
        ].join(', '),
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34, zoom: fit }}>
      <motion.img
        src={BANNER}
        alt={t('app.name')}
        initial={arriveAllowed ? { y: bannerTravel(fit) } : false}
        animate={{ y: 0 }}
        transition={travelTransition}
        // The box is reserved BEFORE the file arrives (the masthead is 796x228): without it the
        // img starts 0-high and the whole centred column jumps down when the art loads.
        style={{ width: 300, maxWidth: '70vw', aspectRatio: '796 / 228', display: 'block' }}
        draggable={false}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLS}, ${TILE_PX}px)`,
          gridAutoRows: TILE_PX,
          gap: TILE_GAP,
          ...contentStyle,
        }}
      >
        {TILES.map((tile) => (
          <motion.div
            key={tile.order}
            initial={false}
            animate={tile.order < shown
              ? { opacity: 1, scale: 1, y: 0 }
              : { opacity: 0, scale: 0.2, y: -MOTIONS['splash.tile.plop'].amplitude! }}
            transition={plopTransition}
            style={{
              gridColumn: tile.x + 1,
              gridRow: tile.y + 1,
              borderRadius: 6.5,
              background: tile.hue,
              // The frame casts no shadows; the pressed edge is a bottom border instead.
              borderBottom: `2px solid ${colors.inkBorder}`,
              boxSizing: 'border-box',
              // A tile lands with an overshoot, and the newest must never pop up UNDER a
              // neighbour that landed before it: later tiles stand higher.
              zIndex: tile.order + 1,
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: 'relative',
          width: 236,
          height: 42,
          borderRadius: 99,
          background: colors.surfacePrimary,
          border: `1.5px solid ${colors.inkBorder}`,
          boxSizing: 'border-box',
          overflow: 'hidden',
          ...contentStyle,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${pct}%`,
            background: colors.sliderYellow,
            borderRadius: 99,
            transition: cssMotion('splash.pill.fill', 'width'),
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: colors.inkText,
            ...roleFont('head'),
          }}
        >
          <span>{t('splash.preparing')}</span>
          {/* A fixed slot sized for "100%", digits CENTRED in it: the composite never moves as
              the count grows, and the ink stays symmetric — left-aligned, the empty remainder of
              the slot pushed the visible text off the pill's centre. */}
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: roleWeight('small'), color: colors.brownText, minWidth: '2.9em', textAlign: 'center' }}>
            {pct}%
          </span>
        </div>
      </div>
      </div>
    </motion.div>
  );
}
