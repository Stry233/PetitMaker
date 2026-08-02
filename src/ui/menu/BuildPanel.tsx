/*
 * BuildPanel.tsx — the Build submenu, built 1:1 from the design canvas (the
 * 建造界面 group). A white speech-bubble card (tail pointing left toward the
 * phone) with a header (icon + title by surface: mountain / river / tile),
 * eight tool buttons (Free/Line/Curve/Rect/Circle/Edge-Cut/Eraser/Move), a
 * brush-size stepper, and — in tile mode — a Dirt/Stone material toggle
 * (taller card). Coordinates are measured from the design canvas.
 *
 * Driven by App's designMode + the store (brushSize / contentType / tileMaterial);
 * the DesignMode type + tool mapping live in ./design-mode.
 */
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../i18n/context';
import { colors, inkTint, font, springs, pressable, btnReset, cursors } from '../styles';
import { usePx } from './scale';
import { squircleClip } from './squircle';
import { iconUrl } from './icons';
import { FitText } from './FitText';
import { makeBox, makeCtext, makeOutlinedTitle } from './panel-utils';
import { SpeechBubble } from './SpeechBubble';
import { SpokeShell } from './SpokeShell';
import { SplatHeader } from './SplatHeader';
import { getCatalogItem } from '../../state/catalog';
import { tileCatalogId } from '../../tools/paint/tile-coating';
import { TOOL_DEFS, type DesignMode } from './design-mode';
import type { AutoEdgeCut } from '../../core/model/types';

// Auto edge-trim cycle order: Off → Bevel (rect/straight) → Round (fan/curved).
const EC_NEXT: Record<AutoEdgeCut, AutoEdgeCut> = { off: 'rect', rect: 'round', round: 'off' };

/** Shape glyph for the auto edge-trim toggle — the corner style it produces:
 *  off = block (square outline), rect = rhombus, round (cut smooth) = circle. */
function edgeCutGlyph(mode: AutoEdgeCut, size: number, color: string) {
  const common = { width: size, height: size, viewBox: '0 0 24 24' };
  if (mode === 'round') {
    return <svg {...common}><circle cx="12" cy="12" r="9" fill={color} /></svg>;
  }
  if (mode === 'rect') {
    return <svg {...common}><polygon points="12,2 22,12 12,22 2,12" fill={color} /></svg>;
  }
  return <svg {...common}><rect x="3.5" y="3.5" width="17" height="17" rx="1.5" fill="none" stroke={color} strokeWidth="2.5" /></svg>;
}

// Positioned by reasoning against the phone card (x44..684), not by a raw
// design-source coordinate: shifted so the tail keeps its ~45px overlap with the
// phone and the card aligns with it while the tail points at the build row.
const POS = { x: 632, y: 287 };
const SIZE = { w: 469 }; // height is dynamic (sizeH)
const CARD = { x: 87, y: 73, w: 380, h: 983, r: 64 };
const TAIL = { x: 7, y: 476, w: 80, h: 96, tipPct: 56.25 };
const C = colors;

// Per-tile PSD layout only; the icon + label come from TOOL_DEFS (the shared tool
// vocabulary) so a tool's presentation lives in one place.
interface Tool { mode: DesignMode; ix: number; iy: number; iw: number; ih: number; lcx: number; lcy: number; }
const TOOLS: Tool[] = [
  { mode: 'brush',    ix: 126, iy: 148, iw: 98,  ih: 115, lcx: 175,   lcy: 290 },
  { mode: 'line',     ix: 241, iy: 151, iw: 193, ih: 111, lcx: 337.5, lcy: 290 },
  { mode: 'curve',    ix: 120, iy: 328, iw: 141, ih: 110, lcx: 190.5, lcy: 467 },
  { mode: 'rect',     ix: 290, iy: 322, iw: 143, ih: 116, lcx: 361.5, lcy: 467 },
  { mode: 'circle',   ix: 119, iy: 506, iw: 137, ih: 120, lcx: 188,   lcy: 655 },
  // Edge Cut (corner trimming for mountain/river/tile) — sits before the eraser.
  { mode: 'edge-cut', ix: 306, iy: 510, iw: 116, ih: 116, lcx: 364.5, lcy: 655 },
  { mode: 'eraser',   ix: 122, iy: 697, iw: 116, ih: 111, lcx: 180,   lcy: 831 },
  // No move/pan tool here — Move is its own phone tile on the home screen.
];
const DOT_DIA = [27, 37, 42, 52, 60]; // green size-dot diameter for brushSize 1..5

const TILE_MATERIALS: { id: 'dirt' | 'stone'; labelKey: string }[] = [
  { id: 'dirt',  labelKey: 'tile.dirt' },
  { id: 'stone', labelKey: 'tile.stone' },
];

interface Props {
  activeMode: DesignMode;
  contentType: 'mountain' | 'water' | 'tile';
  brushSize: number;
  tileMaterial: 'dirt' | 'stone';
  autoEdgeCut: AutoEdgeCut;
  onModeChange: (m: DesignMode) => void;
  onBrushSizeChange: (s: number) => void;
  onTileMaterialChange: (m: 'dirt' | 'stone') => void;
  onAutoEdgeCutChange: (m: AutoEdgeCut) => void;
}

export function BuildPanel({ activeMode, contentType, brushSize, tileMaterial, autoEdgeCut, onModeChange, onBrushSizeChange, onTileMaterialChange, onAutoEdgeCutChange }: Props) {
  const t = useT();
  const reduceMotion = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();

  const box = makeBox(px);
  const ctext = makeCtext(px, pxf, fw);
  // Outlined title: 8px white outer stroke behind the fill (PSD layer effect).
  // Only the submenu TITLE gets this — the other labels are plain.
  // Left-anchored outlined title (lx = left edge) so the icon→title gap is the
  // same for any title/language, instead of a centered title that drifts.
  const outlinedTitle = makeOutlinedTitle(px, pxf, fw);
  const olbl = (lx: number, cy: number, size: number, fill: string, txt: string, opacity = 1) => (
    <span style={{ ...outlinedTitle(lx, cy, size, fill), opacity }}>{txt}</span>
  );

  // Mountain/River show a decorative block illustration; Tile reuses the
  // placement-style header (yellow splat + tile icon) — rendered in the JSX.
  const headIcon = contentType === 'water' ? 'build-head-riv' : 'build-head-mtn';
  const headBox = contentType === 'water' ? box(76, 32, 161, 100) : box(76, 0, 161, 132);
  const titleKey = contentType === 'tile' ? 'menu.build_road' : contentType === 'water' ? 'menu.build_river' : 'menu.build_mountain';

  // Tile mode reuses the placement panel's frame: the tail points lower (at the
  // tile tile, which kept its hub spot) and the card is taller so the Dirt/Stone
  // toggle sits clear below the size stepper. transformOrigin tracks the tail tip.
  const isTile = contentType === 'tile';
  // Road/tile shares Mountain/River's width + tail (same build row), but gets a
  // TALLER card so the Dirt/Stone toggle below the size stepper has clear room.
  const tailY = TAIL.y;
  const tipPct = TAIL.tipPct;
  // The Auto-Trim toggle sits below the size stepper (and, in tile mode, below
  // the Dirt/Stone row), so both cards grow taller to give it clear room.
  const EC = { w: 314, h: 72 };          // full-width pill (aligned with the size stepper), single row
  const ecX = 119;
  const ecY = isTile ? 1080 : 1005;      // below the size stepper (and Dirt/Stone row in tile mode)
  const sizeH = isTile ? 1170 : 1098;
  const cardH = isTile ? 1097 : 1025;
  const originPct = (((tailY + (tipPct / 100) * TAIL.h) / sizeH) * 100).toFixed(1);

  const dia = DOT_DIA[Math.min(5, Math.max(1, brushSize)) - 1] ?? 60;
  const barColor = '#CF7B68';
  // Rect/circle are drag-to-size shape tools — brush size doesn't apply, so
  // the stepper is greyed out and non-interactive for them.
  const sizeDisabled = activeMode === 'rect' || activeMode === 'circle' || activeMode === 'edge-cut';

  return (
    <SpokeShell x={POS.x} y={POS.y} width={SIZE.w} height={sizeH} origin={`1.5% ${originPct}%`}>
      <SpeechBubble px={px} tail={{ x: TAIL.x, y: tailY, w: TAIL.w, h: TAIL.h, tipPct }} card={{ x: CARD.x, y: CARD.y, w: CARD.w, h: cardH, r: CARD.r }} />

      {/* header: Mountain/River show a block illustration with the splat baked
          in; Tile composes the same splat with the road icon. All three sit on
          one anchor — the block's bottom corner at (155.5, 116) at a 118-wide
          block — so the headers differ only in what stands on the block. Title
          is shared (8px white outer stroke, left-anchored so the icon→title gap
          stays constant). */}
      {isTile ? (
        <SplatHeader px={px} icon="road" cx={156} cy={54} iw={119} ih={127} />
      ) : (
        <img src={iconUrl(headIcon)} alt="" draggable={false} style={{ ...headBox, objectFit: 'contain', pointerEvents: 'none' }} />
      )}
      {olbl(247, 75, 35, C.frameDark, t(titleKey))}

      {/* Dirt/Stone material toggle — only in tile mode. Sits below the size
          stepper in the (taller) tile card, clear of every other element. */}
      {isTile && TILE_MATERIALS.map((mat, i) => {
        const active = tileMaterial === mat.id;
        const W = 148, GAP = 12, X0 = 125;
        const x = X0 + i * (W + GAP);
        return (
          <motion.button key={mat.id} type="button" onClick={() => onTileMaterialChange(mat.id)}
            whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }} transition={springs.stiff}
            aria-label={t(mat.labelKey)}
            style={{ ...box(x, 1012, W, 50), clipPath: squircleClip(px(W), px(50), px(24)), background: active ? colors.tilePaleYellow : '#F1ECE3', border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0, opacity: active ? 1 : 0.7, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: px(10) }}>
            <span style={{ width: px(26), height: px(26), borderRadius: '50%', background: getCatalogItem(tileCatalogId(mat.id))?.color ?? '#ccc', border: `${px(2)}px solid ${inkTint(0.18)}` }} />
            <span style={{ fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(28), color: C.inkText, lineHeight: 1 }}>{t(mat.labelKey)}</span>
          </motion.button>
        );
      })}

      {/* brush tools (icon + label; active = full opacity) */}
      {TOOLS.map((tool) => {
        const active = activeMode === tool.mode;
        const def = TOOL_DEFS[tool.mode]; // icon + label from the shared tool vocabulary
        return (
          <span key={tool.mode}>
            <motion.button type="button" onClick={() => onModeChange(tool.mode)}
              whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.92 }} transition={springs.stiff}
              aria-label={t(def.labelKey!)}
              style={{ ...box(tool.ix, tool.iy, tool.iw, tool.ih), ...btnReset, opacity: active ? 1 : 0.5 }}>
              <img src={iconUrl(def.icon!)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </motion.button>
            <FitText cx={tool.lcx} cy={tool.lcy} maxW={150} size={29} color={C.inkText} style={{ opacity: active ? 1 : 0.55 }}>{t(def.labelKey!)}</FitText>
          </span>
        );
      })}

      {/* brush-size stepper (greyed + non-interactive for rect/circle). The
          wrapper is full-panel for child positioning, so it must NOT capture
          pointer events (it would block the tool buttons underneath) — only
          the ± buttons opt back in. */}
      <div style={{ position: 'absolute', inset: 0, opacity: sizeDisabled ? 0.35 : 1, pointerEvents: 'none', transition: 'opacity 0.2s ease' }}>
        <div style={{ ...box(119, 870, 314, 82), clipPath: squircleClip(px(314), px(82), px(38)), background: colors.tilePaleYellow }} />
        {/* size dot — centered via left/top (NOT transform) so its per-step
            scale animation can't clobber the centering and shift the dot. */}
        <motion.div key={brushSize} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={springs.bouncy}
          style={{ position: 'absolute', left: px(166 - dia / 2), top: px(913 - dia / 2), width: px(dia), height: px(dia), borderRadius: '50%', background: '#9AD573' }} />
        {/* minus on the LEFT, plus on the RIGHT: the pair reads as a scale running low to high,
            which is also the order the size dot beside it grows in. */}
        <motion.button type="button" onClick={() => onBrushSizeChange(Math.min(5, brushSize + 1))}
          {...pressable} aria-label={t('a11y.brush_increase')}
          style={{ position: 'absolute', left: px(365 - 56 / 2), top: px(911 - 56 / 2), width: px(56), height: px(56), ...btnReset, pointerEvents: sizeDisabled ? 'none' : 'auto' }}>
          <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: px(48), height: px(15), borderRadius: px(8), background: barColor }} />
          <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: px(15), height: px(48), borderRadius: px(8), background: barColor }} />
        </motion.button>
        <span style={ctext(299, 912, 50, C.white)}>{brushSize}</span>
        <motion.button type="button" onClick={() => onBrushSizeChange(Math.max(1, brushSize - 1))}
          {...pressable} aria-label={t('a11y.brush_decrease')}
          style={{ position: 'absolute', left: px(239 - 56 / 2), top: px(911 - 24 / 2), width: px(56), height: px(24), ...btnReset, pointerEvents: sizeDisabled ? 'none' : 'auto' }}>
          <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: px(48), height: px(15), borderRadius: px(8), background: barColor, display: 'block' }} />
        </motion.button>
        <span style={ctext(277, 982, 29, C.inkText)}>{t('design.brush_size')}</span>
      </div>

      {/* Auto edge-trim toggle — single row: cycles Off → Bevel → Round. Shape
          glyph (the corner style it makes) + label; yellow when active. The trim
          is applied to a finished stroke's exposed corners, post-validation. */}
      <motion.button type="button"
        onClick={() => onAutoEdgeCutChange(EC_NEXT[autoEdgeCut])}
        whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} transition={springs.stiff}
        aria-label={`${t('edgecut.auto')}: ${t('edgecut.' + autoEdgeCut)}`}
        style={{ ...box(ecX, ecY, EC.w, EC.h), clipPath: squircleClip(px(EC.w), px(EC.h), px(36)),
          background: autoEdgeCut === 'off' ? '#F1ECE3' : colors.tilePaleYellow,
          border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0,
          opacity: autoEdgeCut === 'off' ? 0.85 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: px(16) }}>
        {/* keyed by mode → the glyph remounts on toggle and pops in (scale + slight spin)
            so the shape change reads as a small morph. Skipped under reduced-motion. */}
        <motion.span key={autoEdgeCut} style={{ display: 'flex', lineHeight: 0 }}
          initial={reduceMotion ? false : { scale: 0.4, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }} transition={springs.bouncy}>
          {edgeCutGlyph(autoEdgeCut, px(38), C.inkText)}
        </motion.span>
        <span style={{ fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(30), color: C.inkText, lineHeight: 1, whiteSpace: 'nowrap' }}>{t('edgecut.auto')}</span>
      </motion.button>
    </SpokeShell>
  );
}
