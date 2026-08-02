/*
 * LoadBar.tsx — the "load" meter at the top of the card: a dark continuous-
 * corner pill holding the label, a pill track with a colored fill, and the
 * value text centered over the track. Geometry is a 1:1 transcription of the
 * design canvas.
 *
 * The fill and the figure are data-driven (value/max) and shown only while chunk-load enforcement
 * is on; the design source's "8996/10000" is a mock sample.
 */
import type { CSSProperties } from 'react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useT } from '../../i18n/context';
import { colors, font } from '../styles';
import { CHUNK_LOAD_ENABLED } from '../../core/model/constants';
import { LOAD } from './metrics';
import { usePx } from './scale';
import { inkCenterOffset, measureTextW } from './measure-text';
import { squircleClip } from './squircle';

interface LoadBarProps {
  /** Only read while `CHUNK_LOAD_ENABLED`; the meter shows N/A otherwise. */
  value?: number;
  max?: number;
}

// ── Adaptive layout for the "load" label ────────────────────────────────────
// The dark pill stays put (its right edge sits close to the settings gear, and
// growing it leftward looks unbalanced). Instead the label is LEFT-anchored at
// the design x and the TRACK gives up room: the track keeps its right edge fixed
// and its LEFT edge slides right to clear a longer label (ru "Нагрузка",
// fr "Charge"), shrinking the track rather than the pill. Measure the localized
// label (canvas, design px — same technique as LayerPanel.tsx). For zh the
// measured width matches the authored `label.w`, so the track's left edge lands
// exactly on `track.x` — pixel-identical to the baseline.
const LABEL_TRACK_GAP = LOAD.track.x - (LOAD.label.x + LOAD.label.w); // authored gap between label right edge and track
const TRACK_RIGHT = LOAD.track.x + LOAD.track.w; // fixed right edge the track shrinks toward
const TRACK_MIN_W = 132; // never shrink the track below this (safety net for an extreme translation)


export function LoadBar({ value = 0, max = 0 }: LoadBarProps) {
  const t = useT();
  const { scale, px, pxf, fw } = usePx();
  // The in-game load values are unknown, so enforcement is off (see constants) and there is no
  // figure to show. A meter reading 0/10000 forever is worse than one that says so: it looks like a
  // budget the map is not using. The SAME flag governs the rule, so the meter can never claim a
  // number the editor is not actually holding anyone to.
  const enabled = CHUNK_LOAD_ENABLED;
  const ratio = enabled && max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const countText = enabled ? `${value}/${max}` : t('hud.load_na');
  const labelText = t('hud.load');

  // Width for the layout below, plus how far each string's INK sits off its box centre — the pill
  // is short enough that riding high in the line box reads as top-aligned (see `inkCenterOffset`).
  //
  // The ink nudge is measured at the size the text is actually DRAWN at, and applied unscaled. Taken
  // at the design size and multiplied up, the measurement's own rounding is multiplied with it — a
  // fraction of a pixel at 100% becomes a visible lift once the UI is scaled well past it, which
  // reads as the text losing its top padding. The effects below therefore depend on the SCALE, a
  // number: `pxf` is a fresh closure every render, and an effect that re-measures on it would set
  // state on every render, which is a render loop.
  const measure = () => ({
    labelW: measureTextW(labelText, LOAD.label.fontSize),
    labelInk: inkCenterOffset(labelText, pxf(LOAD.label.fontSize)),
    countInk: inkCenterOffset(countText, pxf(LOAD.count.fontSize), 700),
  });
  const [text, setText] = useState(measure);
  useLayoutEffect(() => { setText(measure()); }, [labelText, countText, scale]);
  useEffect(() => {
    const fonts = (document as { fonts?: { ready: Promise<unknown> } }).fonts;
    let alive = true;
    fonts?.ready.then(() => { if (alive) setText(measure()); });
    return () => { alive = false; };
  }, [labelText, countText, scale]);
  const labelW = text.labelW;

  // Track left edge slides right to clear the label; right edge stays fixed, so
  // the track shrinks. zh lands exactly on track.x (no change); longer labels
  // push it right until the TRACK_MIN_W floor.
  const trackLeft = Math.min(TRACK_RIGHT - TRACK_MIN_W, Math.max(LOAD.track.x, LOAD.label.x + labelW + LABEL_TRACK_GAP));
  const trackWDesign = TRACK_RIGHT - trackLeft;

  const bgW = px(LOAD.bg.w);
  const bgH = px(LOAD.bg.h);
  const trackW = px(trackWDesign);
  const trackH = px(LOAD.track.h);

  const container: CSSProperties = {
    position: 'absolute',
    left: px(LOAD.bg.x),
    top: px(LOAD.bg.y),
    width: bgW,
    height: bgH,
    clipPath: squircleClip(bgW, bgH, px(LOAD.bg.r)),
    background: colors.loadDark,
  };

  const track: CSSProperties = {
    position: 'absolute',
    left: px(trackLeft - LOAD.bg.x),
    top: '50%',
    transform: 'translateY(-50%)',
    width: trackW,
    height: trackH,
    clipPath: squircleClip(trackW, trackH, px(LOAD.track.r)),
    background: colors.loadTrack,
  };

  const fill: CSSProperties = {
    width: `${ratio * 100}%`,
    height: '100%',
    background: colors.loadFill,
    transition: 'width 0.25s ease',
  };

  // Left-anchored at the design label x so the pill-edge→label gap is constant;
  // the label grows rightward and the track (above) yields the room. zh sits
  // exactly at its authored position.
  const label: CSSProperties = {
    position: 'absolute',
    left: px(LOAD.label.x - LOAD.bg.x),
    top: '50%',
    transform: `translateY(calc(-50% + ${text.labelInk}px))`,
    fontFamily: font.family,
    fontWeight: fw(900),
    fontSize: pxf(LOAD.label.fontSize),
    color: colors.white,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  };

  const count: CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: `translate(-50%, calc(-50% + ${text.countInk}px))`,
    fontFamily: font.family,
    fontWeight: 700,
    fontSize: pxf(LOAD.count.fontSize),
    color: colors.white,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  };

  return (
    <div style={container}>
      <span style={label}>{labelText}</span>
      <div data-track style={track}>
        <div style={fill} />
        <span data-count style={count}>{countText}</span>
      </div>
    </div>
  );
}
