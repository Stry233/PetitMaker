/** The Settings pictures: the map stamp the grid, chunk and quality tiles draw, the motion samples and the cursor choices. */
import { cssMotion } from '../../../design/motion';
import { ActionButton } from '../../../primitives/ActionButton';
import { type CSSProperties, type ReactNode } from 'react';
import { MotionSample } from '../../../design/motion/MotionSample';
import { font, radii, cursors } from '../../../design/styles';
import { FRAME_INK, ON_DARK, inkTint, SHADE, rgbaOf } from '../../../design/tokens';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { CellZone } from '../../../../core/game/zones';
import { ELEVATION_COLORS, WATER_COLOR, ZONE_COLORS } from '../../../../core/model/palette';
import { templateAnchor } from '../../../../core/model/landmarks';
import { DEFAULT_MAP } from '../../../../config/maps';
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

/** The overlays the two toggles show. Grid lines are white like the canvas's own (alpha raised —
 *  the canvas's 0.14 vanishes at stamp scale); chunk bounds are the renderer's black at 0.35. */
export function MapOverlay({ kind, on }: { kind: 'grid' | 'chunks'; on: boolean }): ReactNode {
  const style: CSSProperties = { opacity: on ? 1 : 0, transition: cssMotion('control.fade', ['opacity']) };
  if (kind === 'grid') {
    return (
      <g style={style} stroke={rgbaOf(ON_DARK, 0.65)} strokeWidth={1}>
        {Array.from({ length: 9 }, (_, i) => <line key={`v${i}`} x1={(i + 1) * MAP_CELL} y1={0} x2={(i + 1) * MAP_CELL} y2={MAP_H} />)}
        {Array.from({ length: 6 }, (_, i) => <line key={`h${i}`} x1={0} y1={(i + 1) * MAP_CELL} x2={MAP_W} y2={(i + 1) * MAP_CELL} />)}
      </g>
    );
  }
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

export const capStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
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

export function MapTile({ kind, on, label, onToggle }: { kind: 'grid' | 'chunks'; on: boolean; label: string; onToggle: () => void }) {
  return (
    <ActionButton interaction="toggle"
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      style={tileStyle}
      onClick={onToggle}
   >
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="none" style={picStyle(on)} aria-hidden>
        <MapBase />
        <MapOverlay kind={kind} on={on} />
      </svg>
      <span style={capStyle}><span style={capDot(on)} />{label}</span>
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
