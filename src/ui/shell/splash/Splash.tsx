/*
 * The boot splash: a small map builds tile by tile while the art downloads, then slides away as the app
 * slides in beneath it. Only on a first fetch (`shouldShowSplash`); progress is real, with a floor on
 * the total time. The hand-off's transform on the app root lives only for the boot and ends at
 * `transform: none`. The brand is the deployment's readme masthead.
 */
import { useEffect, useState } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { font, z, radii } from '../../design/styles';
import { FRAME_INK, HAIRLINE, MUTED, PLATE, SLIDER_YELLOW, inkTint } from '../../design/tokens';
import { roleWeight, roleFont } from '../../design/text-weight';
import { MOTIONS } from '../../design/motion/registry';
import { useTransition, useMotionAllowed } from '../../design/motion/use-motion';
import { cssMotion } from '../../design/motion';
import { activeTarget } from '../../../platform/build/deploy-targets';
import { preloadAssets } from './preload';
import { markSplashDone } from '../../../io/storage/splash-facts';
import { useViewportSize } from '../../design/scale';
import { ZONE_COLORS, ELEVATION_COLORS, WATER_COLOR } from '../../../core/model/palette';
import { CellZone } from '../../../core/game/zones';
import { useEffectEvent } from '../../primitives/use-effect-event';

// The boot loader's own masthead URL, already downloaded; the domain alone picks the art so no wordmark
// swaps mid-boot.
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
  s: ZONE_COLORS[CellZone.Beach]!, g: ZONE_COLORS[CellZone.Grass]!, m: ELEVATION_COLORS[1]!, M: ELEVATION_COLORS[2]!, p: WATER_COLOR,
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
function splashFit(viewportH: number): number {
  return Math.min(1, viewportH / SPLASH_ROOM);
}

/** How far below its resting place the banner opens, in the column's own px: the boot loader's
 *  centred banner top (50vh - 63) minus the zoomed column's (50vh - 184 * fit). */
function bannerTravel(fit: number): number {
  return (184 * fit - 63) / fit;
}

interface SplashProps {
  /** Fired when the hand-off starts — App slides its content plane on the same clock. */
  onHandoff: () => void;
  /** Fired when the hand-off has finished and the overlay may unmount. */
  onDone: () => void;
}

export function Splash({ onHandoff, onDone }: SplashProps) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const plopTransition = useTransition('splash.tile.plop');
  const handoffTransition = useTransition('splash.handoff');
  const [progress, setProgress] = useState(0); // 0..1, fetch-true
  const [leaving, setLeaving] = useState(false);
  // The banner opens where the boot loader drew it and slides up; the offset is arithmetic between the two
  // 50vh-centred columns, so the first frame already stands at the start.
  const [phase, setPhase] = useState<'arriving' | 'ready'>('arriving');
  const arriveAllowed = useMotionAllowed('splash.logo.travel');
  const travelTransition = useTransition('splash.logo.travel');
  const fit = splashFit(useViewportSize().h);

  useEffect(() => {
    if (!arriveAllowed) { setPhase('ready'); return; }
    const id = setTimeout(() => setPhase('ready'), MOTIONS['splash.logo.travel'].duration! * 1000);
    return () => clearTimeout(id);
  }, [arriveAllowed]);

  /** The fade the map, the pill and the banner share once the logo has landed. */
  const contentStyle = {
    opacity: phase === 'ready' ? 1 : 0,
    transition: cssMotion('splash.content.fade', ['opacity']),
  } as const;

  // The preload runs once for the component's life; the handoff and the motion setting are read as it lands.
  const handOff = useEffectEvent(() => onHandoff());
  const finish = useEffectEvent(() => onDone());
  const handoffMs = useEffectEvent(() => (reduced ? 0 : MOTIONS['splash.handoff'].duration! * 1000));
  useEffect(() => {
    // No once-only ref: StrictMode's remount runs its own chain, and the preload itself is multiplexed.
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
      handOff();
      await wait(handoffMs());
      if (!cancelled) finish();
    });
    return () => { cancelled = true; subscription.abort(); };
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
          `repeating-linear-gradient(0deg, transparent 0 33px, ${inkTint(0.05)} 33px 34px)`,
          `repeating-linear-gradient(90deg, transparent 0 33px, ${inkTint(0.05)} 33px 34px)`,
          PLATE,
        ].join(', '),
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, zoom: fit }}>
      <motion.img
        src={BANNER}
        alt={t('app.name')}
        initial={arriveAllowed ? { y: bannerTravel(fit) } : false}
        animate={{ y: 0 }}
        transition={travelTransition}
        // The box is reserved before the file arrives (the masthead is 796x228): without it the
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
              borderRadius: radii.chip,
              background: tile.hue,
              // The frame casts no shadows; the pressed edge is a bottom border instead.
              borderBottom: `2px solid ${HAIRLINE}`,
              boxSizing: 'border-box',
              // A tile lands with an overshoot, and the newest must never pop up under a
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
          borderRadius: radii.pill,
          background: PLATE,
          border: `1.5px solid ${HAIRLINE}`,
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
            background: SLIDER_YELLOW,
            borderRadius: radii.pill,
            transition: cssMotion('splash.pill.fill', ['width']),
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
            color: FRAME_INK,
            ...roleFont('head'),
          }}
        >
          <span>{t('splash.preparing')}</span>
          {/* A fixed slot sized for 100% with centred digits, so the count never moves the pill's ink. */}
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: roleWeight('small'), color: MUTED, minWidth: '2.9em', textAlign: 'center' }}>
            {pct}%
          </span>
        </div>
      </div>
      </div>
    </motion.div>
  );
}
