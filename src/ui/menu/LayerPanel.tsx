/*
 * LayerPanel.tsx — the v2 Layer panel, built 1:1 from the design canvas (图层组). A dark
 * translucent "smoky glass" card floating top-right: title 图层, a scrollable
 * list of layer rows (name · 格数 count · eye · lock), and +/− at the bottom.
 * The active layer's row is a yellow pill with brown text + the brown
 * "*-selected" eye/lock icon variants; other rows use white text + white icons.
 *
 * Always visible (independent of the phone menu); wires to the existing
 * layer store actions. Coordinates are measured from the design canvas (group 349x654).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../i18n/context';
import { ELEVATION_MAX } from '../../core/model/constants';
import type { LayerInfo } from '../../core/model/layer-utils';
import { useEditorStore } from '../../state/store';
import { colors, font, pressable, btnReset, springs, cursors } from '../styles';
import { usePx } from './scale';
import { measureTextW } from './measure-text';
import { squircleClip } from './squircle';
import { iconUrl } from './icons';
import { tourTargetAttr } from '../chrome/tour/steps';

const CARD_X = 10;   // card left inset within the panel
const ROW0 = 100;    // first row top
const ROW = 72;      // row pitch
const CARD_H = 654;
const CARD_R = 42;
const BROWN = '#574735';
const WHITE = colors.white;

// ── Adaptive column layout ──────────────────────────────────────────────────
// The row is laid out at fixed columns, but the columns are MEASURED from the actual localized
// text (name / "Cells" label / count) so longer languages (ru "Уровень", ja "階層", fr "Hauteur")
// get more room at FULL size — the panel widens to fit rather than shrinking or overlapping text.
// Widths are measured in design px (canvas measureText at the raw design font sizes); px()/pxf()
// scale everything uniformly afterwards.
interface Cols { nameX: number; cellsX: number; countX: number; eyeX: number; lockX: number; cardW: number; sizeW: number }

const NAME_SIZE = 34, CELLS_SIZE = 27, ROW_WEIGHT = 900;
const NAME_X = 36, COL_GAP = 16, COUNT_ICON_GAP = 18, EYE_LOCK_GAP = 10, EYE_W = 41, LOCK_W = 44;
const CARD_RIGHT_PAD = 12, PANEL_RIGHT_INSET = 15;

function computeCols(names: string[], cellsLabel: string): Cols {
  const nameW = Math.max(1, ...names.map((n) => measureTextW(n, NAME_SIZE, ROW_WEIGHT)));
  const cellsW = measureTextW(cellsLabel, CELLS_SIZE);
  const countW = measureTextW('99999', CELLS_SIZE); // reserve a fixed 5-digit slot so it never shifts
  const cellsX = NAME_X + nameW + COL_GAP;
  const countX = cellsX + cellsW + COL_GAP;
  const eyeX = countX + countW + COUNT_ICON_GAP + EYE_W / 2;   // icon CENTERS (see iconBtn)
  const lockX = eyeX + EYE_W / 2 + EYE_LOCK_GAP + LOCK_W / 2;
  const cardW = lockX + LOCK_W / 2 + CARD_RIGHT_PAD - CARD_X;  // card ends just past the lock icon
  const sizeW = CARD_X + cardW + PANEL_RIGHT_INSET;
  return { nameX: NAME_X, cellsX, countX, eyeX, lockX, cardW, sizeW };
}

/** Columns sized to the current locale's text. Recomputes on locale change and once the web font
 *  finishes loading (the first measure may use a fallback metric). */
function useAdaptiveColumns(locale: string, t: (k: string, v?: Record<string, string>) => string): Cols {
  const names = useMemo(
    () => [t('layer.ground'), ...Array.from({ length: ELEVATION_MAX }, (_, i) => t('layer.name', { n: String(i + 1) }))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  const cellsLabel = t('layer.cells');
  const [cols, setCols] = useState(() => computeCols(names, cellsLabel));
  useLayoutEffect(() => { setCols(computeCols(names, cellsLabel)); }, [names, cellsLabel]);
  useEffect(() => {
    const fonts = (document as { fonts?: { ready: Promise<unknown> } }).fonts;
    let alive = true;
    fonts?.ready.then(() => { if (alive) setCols(computeCols(names, cellsLabel)); });
    return () => { alive = false; };
  }, [names, cellsLabel]);
  return cols;
}

interface Props {
  layers: LayerInfo[];
  activeLayer: number;          // build floor (drives +/-); user's explicit selection
  highlightLayer?: number;      // which row shows the yellow pill (follows auto-stacking)
  layerVisibility: Record<number, boolean>;
  layerLocked: Record<number, boolean>;
  onSelectLayer: (elevation: number) => void;
  onToggleVisibility: (elevation: number) => void;
  onToggleLock: (elevation: number) => void;
}

export function LayerPanel({ layers, activeLayer, highlightLayer, layerVisibility, layerLocked, onSelectLayer, onToggleVisibility, onToggleLock }: Props) {
  const t = useT();
  const { px, pxf, fw } = usePx();
  const sorted = [...layers].sort((a, b) => b.elevation - a.elevation); // highest first
  const highlight = highlightLayer ?? activeLayer; // pill follows auto-stacking
  const locale = useEditorStore((s) => s.locale);
  const showLayerNumbers = useEditorStore((s) => s.showLayerNumbers);
  const setShowLayerNumbers = useEditorStore((s) => s.setShowLayerNumbers);
  const viewMode = useEditorStore((s) => s.viewMode);

  // When a paint is rejected because its layer is locked (cause is
  // off-canvas), pulse the locked rows so the reason is visible.
  const eventBus = useEditorStore((s) => s.eventBus);
  const [lockPulse, setLockPulse] = useState(0);
  const [pulsing, setPulsing] = useState(false);
  const pulseTimer = useRef<number | null>(null);
  useEffect(() => {
    const onFail = (data: { errors: { ruleId: string }[] }) => {
      if (data.errors.some((e) => e.ruleId === 'V-LOCK-01')) {
        setLockPulse((n) => n + 1);
        setPulsing(true);
        // One tracked timeout: rapid rejections (a brush dragged across a locked
        // layer) must extend the pulse, not let an older timer cut a newer one short.
        if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
        pulseTimer.current = window.setTimeout(() => { pulseTimer.current = null; setPulsing(false); }, 550);
      }
    };
    eventBus.on('validation-failed', onFail);
    return () => {
      eventBus.off('validation-failed', onFail);
      if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
    };
  }, [eventBus]);

  // Columns measured from the current locale's text so the panel WIDENS to fit longer languages
  // (ru "Уровень", ja "階層", fr "Hauteur") at full size — no shrinking, no overlap. Chinese is the
  // narrowest; Cyrillic/Latin produce a wider panel.
  const { sizeW, cardW, nameX, cellsX, countX, eyeX, lockX } = useAdaptiveColumns(locale, t);
  // The active-row pill is intentionally WIDER than the smoky card so its rounded ends peek out of
  // the box. Centered on the card → the overhang is symmetric on both sides. The rows list hides
  // its native scrollbar (see the container's className) so the pill's right end is never clipped;
  // the peeking bottom row cues scrollability.
  const PILL_OVERHANG = 11;
  const pillW = cardW + PILL_OVERHANG * 2;
  const pillLeft = CARD_X - PILL_OVERHANG;
  // The pill's pop-in spring overshoots slightly past scale 1, briefly pushing its rounded ends
  // beyond the row box. The rows live in a scroll container whose overflow (forced by vertical
  // scroll) would clip that overshoot. Widen the container's clip by HPAD on each side with matching
  // padding: normal-flow rows re-anchor to the same place, so nothing shifts — the clip just gains room.
  const HPAD = 16;
  const titleX = sizeW / 2;
  const plusX = sizeW / 2 - 56;
  const minusX = sizeW / 2 + 52;

  // Left-anchored, vertically-centered row text at a fixed column x.
  const ltext = (left: number, size: number, color: string): CSSProperties => ({
    position: 'absolute', left: px(left), top: '50%', transform: 'translateY(-50%)',
    fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(size), color, lineHeight: 1,
    whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none',
  });

  // dy nudges the icon off the row center (the PSD seats the lock ~5px high).
  // Position with left/top only — NO centering transform — so Framer Motion's
  // whileTap scale owns `transform` and can't clobber the position (which made
  // the button jump to its anchor on click).
  const iconBtn = (cx: number, w: number, h: number, dy = 0): CSSProperties => ({
    position: 'absolute', left: px(cx - w / 2), top: px(ROW / 2 - h / 2 + dy),
    width: px(w), height: px(h), background: 'none', border: 'none', appearance: 'none',
    cursor: cursors.clickable, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  });

  return (
    <motion.div
      style={{ position: 'fixed', top: px(62), right: px(31), width: px(sizeW), height: px(CARD_H), zIndex: 100, filter: `drop-shadow(0 ${px(10)}px ${px(20)}px rgba(0,0,0,0.25))` }}
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {/* smoky-glass card */}
      <div style={{ position: 'absolute', left: px(CARD_X), top: 0, width: px(cardW), height: px(CARD_H), clipPath: squircleClip(px(cardW), px(CARD_H), px(CARD_R)), background: 'rgba(52,52,52,0.46)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }} />

      {/* title (centered in the panel — no leading icon, so it stays centered) */}
      <span style={{ position: 'absolute', left: px(titleX), top: px(57), transform: 'translate(-50%, -50%)', ...font.h1, fontWeight: fw(900), fontSize: pxf(45), color: WHITE, lineHeight: 1 }}>{t('layer.title')}</span>

      {/* layer-number overlay toggle (top-right corner). Paints the elevation
          number on every cell; the ON state borrows the active-pill yellow so it
          reads as "enabled", consistent with the panel's selection language. */}
      <motion.button
        type="button"
        onClick={() => setShowLayerNumbers(!showLayerNumbers)}
        {...pressable}
        {...tourTargetAttr('layer-numbers')}
        aria-label={t('a11y.toggle_layer_numbers')}
        aria-pressed={showLayerNumbers}
        style={{
          position: 'absolute', left: px(CARD_X + cardW - 74), top: px(35),
          width: px(58), height: px(44), borderRadius: px(15),
          background: showLayerNumbers ? '#FFF481' : 'rgba(255,255,255,0.14)',
          border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 160ms ease', WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span style={{ fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(30), lineHeight: 1, color: showLayerNumbers ? BROWN : WHITE }}>#</span>
      </motion.button>

      {/* 3D button (top-left corner) — pixel-symmetric with the '#' toggle on
          the right. Toggles the in-place 3D editor view; the layer panel and
          phone menu stay, and the full 2D tool set works on the 3D surface. */}
      <motion.button
        type="button"
        onClick={() => {
          const s = useEditorStore.getState();
          s.setViewMode(s.viewMode === '3d' ? '2d' : '3d');
        }}
        {...pressable}
        {...tourTargetAttr('view-toggle')}
        aria-label={t('a11y.open_3d_preview')}
        aria-pressed={viewMode === '3d'}
        style={{
          position: 'absolute', left: px(CARD_X + 16), top: px(35),
          width: px(58), height: px(44), borderRadius: px(15),
          // Active state mirrors the '#' numbers toggle exactly (same lit
          // yellow, same background transition).
          background: viewMode === '3d' ? '#FFF481' : 'rgba(255,255,255,0.14)',
          border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 160ms ease', WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span
          aria-hidden
          style={{
            width: px(35), height: px(35), display: 'inline-block',
            // Masked glyph so the icon takes the toggle's ink exactly like the
            // '#' text does (brown on the lit pill, white otherwise); the soft
            // same-color halo reads as a slightly bolder stroke.
            backgroundColor: viewMode === '3d' ? BROWN : WHITE,
            WebkitMaskImage: `url(${iconUrl('preview-3d')})`,
            maskImage: `url(${iconUrl('preview-3d')})`,
            WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
            WebkitMaskSize: 'contain', maskSize: 'contain',
            WebkitMaskPosition: 'center', maskPosition: 'center',
            filter: `drop-shadow(0 0 0.8px ${viewMode === '3d' ? BROWN : WHITE}) drop-shadow(0 0 0.8px ${viewMode === '3d' ? BROWN : WHITE})`,
            transition: 'background-color 160ms ease',
          }}
        />
      </motion.button>

      {/* scrollable layer rows */}
      <div className="layer-rows-scroll" style={{ position: 'absolute', left: px(-HPAD), top: px(ROW0), width: px(sizeW + 2 * HPAD), height: px(560 - ROW0), boxSizing: 'border-box', paddingTop: px(10), paddingBottom: px(10), paddingLeft: px(HPAD), paddingRight: px(HPAD), overflowY: 'auto', overflowX: 'hidden' }}>
        {sorted.map((layer) => {
          const elev = layer.elevation;
          const active = elev === highlight;
          const visible = layerVisibility[elev] !== false;
          const locked = layerLocked[elev] === true;
          const ink = active ? BROWN : WHITE;
          const sfx = active ? '-selected' : '';
          const eyeIcon = (visible ? 'eye-open' : 'eye-closed') + sfx;
          const lockIcon = (locked ? 'lock' : 'unlock') + sfx;
          const name = elev === 0 ? t('layer.ground') : t('layer.name', { n: String(elev) });
          return (
            <div key={elev} style={{ position: 'relative', height: px(ROW) }}>
              {active && (
                // The active pill pops in on selection. Positioned by
                // top (not translateY) so Framer's scale owns transform cleanly.
                <motion.div
                  initial={{ scale: 0.92, opacity: 0.85 }} animate={{ scale: 1, opacity: 1 }} transition={springs.bouncy}
                  style={{ position: 'absolute', left: px(pillLeft), top: px((ROW - 84) / 2), width: px(pillW), height: px(84), clipPath: squircleClip(px(pillW), px(84), px(39)), background: '#FFF481' }} />
              )}
              {locked && pulsing && (
                <motion.div key={lockPulse} initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} transition={{ duration: 0.5 }}
                  style={{ position: 'absolute', left: px(pillLeft), top: px((ROW - 84) / 2), width: px(pillW), height: px(84), clipPath: squircleClip(px(pillW), px(84), px(39)), background: '#ff6b6b', pointerEvents: 'none' }} />
              )}
              <button type="button" onClick={() => onSelectLayer(elev)} aria-label={name}
                style={{ position: 'absolute', inset: 0, ...btnReset }} />
              {/* name · 格数 · count at ADAPTIVE columns (measured from the actual localized text,
                  see useAdaptiveColumns) so longer translations get more room at FULL size — never
                  shrunk, never overlapping. The count column reserves a fixed 5-digit width so it
                  stays put as counts grow. */}
              <span style={ltext(nameX, 34, ink)}>{name}</span>
              <span style={ltext(cellsX, 27, ink)}>{t('layer.cells')}</span>
              <span style={ltext(countX, 27, ink)}>{String(layer.cellCount).padStart(2, '0')}</span>
              <motion.button type="button" onClick={() => onToggleVisibility(elev)} {...pressable} aria-label={t('a11y.toggle_visibility')} style={iconBtn(eyeX, 41, 34)}>
                <img src={iconUrl(eyeIcon)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </motion.button>
              <motion.button type="button" onClick={() => onToggleLock(elev)} {...pressable} aria-label={t('a11y.toggle_lock')} style={iconBtn(lockX, 44, 42, -5)}>
                <img src={iconUrl(lockIcon)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </motion.button>
            </div>
          );
        })}
      </div>

      {/* add (+) / remove (−) layer */}
      <motion.button type="button" onClick={() => onSelectLayer(Math.min(ELEVATION_MAX, highlight + 1))} {...pressable} aria-label={t('a11y.add_layer')}
        style={{ position: 'absolute', left: px(plusX - 65 / 2), top: px(611 - 65 / 2), width: px(65), height: px(65), ...btnReset }}>
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: px(56), height: px(16), borderRadius: px(8), background: WHITE }} />
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: px(16), height: px(56), borderRadius: px(8), background: WHITE }} />
      </motion.button>
      <motion.button type="button" onClick={() => onSelectLayer(Math.max(0, highlight - 1))} {...pressable} aria-label={t('a11y.remove_layer')}
        style={{ position: 'absolute', left: px(minusX - 65 / 2), top: px(610 - 24 / 2), width: px(65), height: px(24), ...btnReset }}>
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: px(56), height: px(16), borderRadius: px(8), background: WHITE }} />
      </motion.button>
    </motion.div>
  );
}
