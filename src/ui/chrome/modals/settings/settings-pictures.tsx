/** The Settings pictures: the map stamp the grid, chunk and quality tiles draw, the motion samples and the cursor choices. */
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { cssMotion, holdSeconds, presence } from '../../../design/motion';
import { ActionButton } from '../../../primitives/ActionButton';
import { fadeMask } from '../../../primitives/scroll-fade';
import { useSizeGlide } from '../../../primitives/use-size-glide';
import { useTransient } from '../../../primitives/use-transient';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { MotionSample } from '../../../design/motion/MotionSample';
import { font, radii, cursors, visuallyHidden } from '../../../design/styles';
import { FRAME_INK, ON_DARK, inkTint, SHADE, rgbaOf } from '../../../design/tokens';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { CellZone } from '../../../../core/game/zones';
import { ELEVATION_COLORS, WATER_COLOR, ZONE_COLORS } from '../../../../core/model/palette';
import { templateAnchor } from '../../../../core/model/landmarks';
import { DEFAULT_MAP } from '../../../../config/maps';
import { GRIDS, PLACEMENT_GRID, TERRAIN_GRID } from '../../../../core/game/profile';
import type { GridId } from '../../../../core/grid/grids';
import type { GridMode } from '../../../../platform/storage/prefs';
import { cursorArt } from '../../../../assets/cursors/cursor-art';
import { iconUrl } from '../../../../assets/icon-urls';
import { resolveReducedMotion, useOsReducedMotion } from '../../../session/use-motion-enabled';

/* ── the mini-map every picture tile draws ─────────────────────────────────
 * A 10×7-cell postage stamp of a map in the real palette (zone + elevation
 * constants), so the toggles and the quality trio show their effect on the
 * thing itself rather than naming it. One drawing shared by all five tiles:
 * a pond with a sand rim, a stepped mountain, the plaza, the rest grass. */
export const MAP_CELL = 12;
export const MAP_W = 10 * MAP_CELL;
export const MAP_H = 7 * MAP_CELL;
const GRASS = ZONE_COLORS[CellZone.Grass]!;
const SEA = WATER_COLOR;
const SAND = ZONE_COLORS[CellZone.Beach]!;
/** The plaza in the colour the default planet lays it in. */
const PLAZA = templateAnchor(DEFAULT_MAP)?.color ?? GRASS;
const POND: Array<[number, number]> = [[0, 4], [1, 4], [0, 5], [1, 5], [2, 5], [0, 6], [1, 6], [2, 6]];
const RIM: Array<[number, number]> = [[0, 3], [1, 3], [2, 3], [2, 4], [3, 4], [3, 5], [3, 6]];
export const MOUNT_1: Array<[number, number]> = [[6, 0], [7, 0], [8, 0], [9, 0], [6, 1], [7, 1], [8, 1], [9, 1], [7, 2], [8, 2], [9, 2]];
export const MOUNT_2: Array<[number, number]> = [[7, 0], [8, 0], [9, 0], [8, 1], [9, 1]];
export const MOUNT_3: Array<[number, number]> = [[9, 0], [9, 1]];
export const PLAZA_CELLS: Array<[number, number]> = [[4, 2], [5, 2], [4, 3], [5, 3]];

function cells(at: Array<[number, number]>, fill: string): ReactNode {
  return at.map(([x, y]) => (
    <rect key={`${x}-${y}`} x={x * MAP_CELL} y={y * MAP_CELL} width={MAP_CELL} height={MAP_CELL} fill={fill} />
  ));
}

export function MapBase(): ReactNode {
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

/** Cell lines over the stamp and one cell past each edge, so a shifted set still covers it. */
const CELL_LINES = (
  <>
    {Array.from({ length: 11 }, (_, i) => <line key={`v${i}`} x1={i * MAP_CELL} y1={-MAP_CELL} x2={i * MAP_CELL} y2={MAP_H + MAP_CELL} />)}
    {Array.from({ length: 8 }, (_, i) => <line key={`h${i}`} x1={-MAP_CELL} y1={i * MAP_CELL} x2={MAP_W + MAP_CELL} y2={i * MAP_CELL} />)}
  </>
);

/** The cell lines standing at `grid`'s offset, gliding when it changes. */
function GridLines({ grid }: { grid: GridId }): ReactNode {
  const { x, y } = GRIDS[grid].offset;
  return (
    <g style={{ transform: `translate(${x * MAP_CELL}px, ${y * MAP_CELL}px)`, transition: cssMotion('settings.grid.shift', ['transform']) }}>
      {CELL_LINES}
    </g>
  );
}

/** The grid tile's lines for `mode`: the object grid, the terrain grid, or for the automatic grid
 *  the object grid on the left and the terrain grid on the right of a diagonal. Off keeps the last
 *  lines and fades them out. Lines are white like the canvas's own (alpha raised: the canvas's
 *  0.14 vanishes at stamp scale). */
export function GridOverlay({ mode, shown }: { mode: GridMode; shown: Exclude<GridMode, 'off'> }): ReactNode {
  const clip = `grid-clip-${useId().replace(/[^\w-]/g, '')}`;
  const left = shown === 'auto' ? PLACEMENT_GRID : shown;
  const right = shown === 'auto' ? TERRAIN_GRID : shown;
  return (
    <g style={{ opacity: mode === 'off' ? 0 : 1, transition: cssMotion('control.fade', ['opacity']) }} stroke={rgbaOf(ON_DARK, 0.65)} strokeWidth={1}>
      <clipPath id={`${clip}l`}><polygon points={`0,0 ${MAP_W * 0.65},0 ${MAP_W * 0.35},${MAP_H} 0,${MAP_H}`} /></clipPath>
      <clipPath id={`${clip}r`}><polygon points={`${MAP_W * 0.65},0 ${MAP_W},0 ${MAP_W},${MAP_H} ${MAP_W * 0.35},${MAP_H}`} /></clipPath>
      <g clipPath={`url(#${clip}l)`}><GridLines grid={left} /></g>
      <g clipPath={`url(#${clip}r)`}><GridLines grid={right} /></g>
    </g>
  );
}

/** The chunk bounds the chunk tile shows, the renderer's black at 0.35. */
export function ChunkOverlay({ on }: { on: boolean }): ReactNode {
  const style: CSSProperties = { opacity: on ? 1 : 0, transition: cssMotion('control.fade', ['opacity']) };
  return (
    <g style={style} stroke={rgbaOf(SHADE, 0.35)} strokeWidth={2}>
      <line x1={5 * MAP_CELL} y1={0} x2={5 * MAP_CELL} y2={MAP_H} />
      <line x1={0} y1={3.5 * MAP_CELL} x2={MAP_W} y2={3.5 * MAP_CELL} />
    </g>
  );
}

// Matching camera frames expose model detail and shadows; Auto combines the two device profiles.
export const QUALITY_FULL_URL = iconUrl('settings-quality-full');
export const QUALITY_LITE_URL = iconUrl('settings-quality-lite');

export const qualityImg = (clip?: 'left' | 'right'): CSSProperties => ({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  ...(clip ? { clipPath: clip === 'left' ? 'polygon(0 0, 65% 0, 35% 100%, 0 100%)' : 'polygon(65% 0, 100% 0, 100% 100%, 35% 100%)' } : {}),
});

export function QualityShot({ q }: { q: 'auto' | 'full' | 'lite' }): ReactNode {
  if (q === 'full') return <img src={QUALITY_FULL_URL} alt="" style={qualityImg()} />;
  if (q === 'lite') return <img src={QUALITY_LITE_URL} alt="" style={qualityImg()} />;
  return (
    <>
      <img src={QUALITY_LITE_URL} alt="" style={qualityImg('left')} />
      <img src={QUALITY_FULL_URL} alt="" style={qualityImg('right')} />
      <svg viewBox="0 0 100 75" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <path d="M65 0L35 75" fill="none" stroke={skin.plate} strokeWidth={2} />
      </svg>
    </>
  );
}

/* ── tile chrome shared by the toggles and the quality trio ───────────── */

export const picStyle = (on: boolean): CSSProperties => ({
  display: 'block',
  width: '100%',
  aspectRatio: '4 / 3',
  borderRadius: radii.md,
  overflow: 'hidden',
  background: GRASS,
  boxShadow: on
    ? `inset 0 0 0 1px ${inkTint(0.12)}, 0 0 0 3px ${skin.active}`
    : `inset 0 0 0 1px ${inkTint(0.12)}`,
  transition: cssMotion('control.paint', ['box-shadow']),
});

export const tileStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: cursors.clickable,
};

/** Space between a caption's dot and its text, in CSS px. */
const CAP_GAP = 6;

export const capStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: CAP_GAP,
  ...roleFont('chip'),
  fontFamily: font.family,
  color: skin.plateInk,
};

export const capDot = (on: boolean): CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: radii.pill,
  background: on ? skin.active : skin.track,
  transition: cssMotion('control.paint', ['background-color']),
});

/** How long a pressed tile's caption shows the new value before it names the setting again. */
const CAPTION_HOLD_MS = holdSeconds('settings.label.morph') * 1000;

/** Each drawn wording lies over the box and centres in it; a wording wider than the box spills
 *  evenly both ways, so text and box stay centred together while the width glides. */
const morphLayer: CSSProperties = { position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', textAlign: 'center' };

/** Room beside the box where a spilling wording fades out instead of being cut, as far as the dot
 *  so it never covers it. */
const SPILL_X = CAP_GAP;
const SPILL_MASK = fadeMask('x', { start: SPILL_X, end: SPILL_X });
/** Padded out by the spill room and pulled back by as much, so it takes only the box's own space;
 *  the text stays inside the mask's opaque middle at rest, so the mask never needs to come off. */
const spillFrame: CSSProperties = {
  display: 'block', minWidth: 0,
  margin: `0 -${SPILL_X}px`, padding: `0 ${SPILL_X}px`,
  WebkitMaskImage: SPILL_MASK, maskImage: SPILL_MASK,
};

const CROSSFADE = presence('settings.label.morph', { opacity: 0 });

/**
 * A tile caption's drawn wording. The box takes the width of `text` from a hidden copy and glides
 * to it when `text` changes, while the old wording fades out and the new one in over it; reduced
 * motion swaps the text and the width at once. Purely visual: the tile speaks for itself.
 */
function MorphLabel({ text }: { text: string }): ReactNode {
  const reduced = useReducedMotionConfig() === true;
  const { ref, gliding } = useSizeGlide<HTMLSpanElement>(text, { axis: 'width', motionId: 'settings.label.morph' });
  return (
    <span aria-hidden style={spillFrame}>
      {/* The box whose width glides; its white-space is inherited by every layer, so a wording on
          its way out spills rather than wraps. */}
      <span ref={ref} style={{ position: 'relative', display: 'block', whiteSpace: gliding ? 'nowrap' : 'normal' }}>
        <span style={{ display: 'block', visibility: 'hidden', textAlign: 'center' }}>{text}</span>
        {reduced ? <span data-testid="morph-label" style={morphLayer}><span>{text}</span></span> : (
          <AnimatePresence initial={false}>
            <motion.span
              key={text}
              data-testid="morph-label"
              {...CROSSFADE}
              style={morphLayer}
            >
              <span>{text}</span>
            </motion.span>
          </AnimatePresence>
        )}
      </span>
    </span>
  );
}

const dotSeat: CSSProperties = { display: 'flex', alignItems: 'center', flexShrink: 0 };

/**
 * A map-stamp tile: the picture is what the setting shows on the map. The caption names the setting
 * at rest; a press morphs it to the value the press gave, `state`, which stands for the registry's
 * hold (a further press shows the newer value and restarts it) before the name returns. `asSwitch`
 * makes the tile an on and off switch named `name`; otherwise the button is named by `name` and
 * `state`, and `announce` speaks a new `state` politely.
 */
export function MapTile({ on, name, state, asSwitch = false, announce = false, onPress, children }: {
  on: boolean; name: string; state: string; asSwitch?: boolean; announce?: boolean; onPress: () => void; children: ReactNode;
}) {
  const pressed = useTransient<true>(CAPTION_HOLD_MS);
  return (
    <ActionButton interaction="toggle"
      type="button"
      {...(asSwitch ? { role: 'switch', 'aria-checked': on, 'aria-label': name } : {})}
      style={tileStyle}
      onClick={() => { onPress(); pressed.show(true); }}
   >
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="none" style={picStyle(on)} aria-hidden>
        <MapBase />
        {children}
      </svg>
      <span style={{ ...capStyle, alignItems: 'flex-start' }}>
        {/* The zero-width space gives the seat one line of the caption's height, so the dot
            stays centred on the first line if a caption ever wraps. */}
        <span aria-hidden style={dotSeat}>{'\u200B'}<span style={capDot(on)} /></span>
        {!asSwitch && <span style={visuallyHidden}>{name}</span>}
        {!asSwitch && <span style={visuallyHidden} aria-live={announce ? 'polite' : undefined}>{state}</span>}
        <MorphLabel text={pressed.value ? state : name} />
      </span>
    </ActionButton>
  );
}

/* ── the interface group's steps (motion) and choices (cursor) ─────────── */

export const stepStyle = (on: boolean): CSSProperties => ({
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
  transition: cssMotion('control.paint', ['background-color', 'box-shadow']),
});

export const stepName: CSSProperties = { ...roleFont('chip'), fontFamily: font.family, color: skin.plateInk };

export type MotionPref = 'system' | 'reduced' | 'full';

/** The demo pinwheel: the plain "motion" mark, nothing a visitor could misread as map content. */
export const PINWHEEL = (
  // display: block, or the inline svg sits on the text baseline and its wrapper keeps descender
  // room under it: the rotation origin (50% of the wrapper) then lands below the hub, and the
  // wheel orbits that point instead of spinning on its own centre.
  <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden style={{ display: 'block' }}>
    <g fill={skin.ink}>
      <path d="M12 12 L12 2 A10 10 0 0 1 19 5 Z" />
      <path d="M12 12 L22 12 A10 10 0 0 1 19 19 Z" />
      <path d="M12 12 L12 22 A10 10 0 0 1 5 19 Z" />
      <path d="M12 12 L2 12 A10 10 0 0 1 5 5 Z" />
    </g>
    <circle cx="12" cy="12" r="2.6" fill={skin.plate} stroke={skin.ink} strokeWidth="1" />
  </svg>
);

/** The small monitor the System tile wears: the mark that says the device made this choice. */
export const DEVICE_BADGE = (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden style={{ position: 'absolute', right: -12, bottom: -2 }}>
    <rect x="1" y="1.5" width="13" height="9.5" rx="2" fill={skin.plate} stroke={skin.muted} strokeWidth="1.7" />
    <rect x="4.5" y="12.4" width="6" height="1.8" rx="0.9" fill={skin.muted} />
  </svg>
);

/**
 * Each option performs itself under every preference: Full's pinwheel spins, Reduced's stands
 * still, and System's does whichever this device asks for while wearing the device badge that says
 * who decided. Only the pinwheel is exempt from the reduced-motion gate; the tile's feedback is not.
 */
export function MotionDemo({ pref }: { pref: MotionPref }) {
  // System's demo shows what this device resolves to, read from the same live OS reading as the gates.
  const spins = !resolveReducedMotion(pref, useOsReducedMotion());
  return (
    <span style={{ height: 30, display: 'grid', placeItems: 'center' }} aria-hidden>
      <span style={{ position: 'relative', display: 'block' }}>
        <MotionSample id="settings.orbit" playing={spins}>{PINWHEEL}</MotionSample>
        {pref === 'system' && DEVICE_BADGE}
      </span>
    </span>
  );
}

export const choiceStyle = (on: boolean): CSSProperties => ({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '8px 12px',
  borderRadius: radii.md,
  border: 'none',
  background: on ? skin.active : skin.plate,
  boxShadow: on ? 'none' : `inset 0 0 0 1px ${inkTint(0.10)}`,
  cursor: cursors.clickable,
  transition: cssMotion('control.paint', ['background-color', 'box-shadow']),
  ...roleFont('chip'),
  fontFamily: font.family,
  color: skin.plateInk,
});

/** The OS arrow, drawn — a CSS `cursor` keyword cannot be shown as an image, so the choice shows
 *  a generic arrow silhouette next to the app's real painted art. */
export const SYSTEM_ARROW = (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
    <path d="M6 3 L6 17.5 L9.8 14.4 L12.2 20 L14.9 18.8 L12.5 13.4 L17.5 13 Z" fill={ON_DARK} stroke={FRAME_INK} strokeWidth={1.4} strokeLinejoin="round" />
  </svg>
);

export const PAINTED_ARROW_URL = cursorArt('default');
