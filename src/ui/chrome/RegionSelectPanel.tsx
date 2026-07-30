/*
 * RegionSelectPanel.tsx — the v2 "选择区域笔刷" panel (region-select brush),
 * built 1:1 from the design source (group bbox 526,1431 → 1533,1739; 1007×308).
 * A white rounded card pinned bottom-left: a row of six brush tools (free / line
 * / curve / rect / circle / eraser), then a yellow +N− size stepper and the
 * 清除 (clear) / 完成 (done) buttons. Coordinates are local to the panel
 * origin and scaled via usePx() so it lands at its exact canvas fraction.
 */
import { motion } from 'framer-motion';
import { useT } from '../../i18n/context';
import { colors, font, inkTint, springs, cursors } from '../styles';
import { usePx, useMenuCenterOffset } from '../menu/scale';
import { makeBox } from '../menu/panel-utils';
import { squircleClip } from '../menu/squircle';
import { iconUrl } from '../menu/icons';
import { FitText } from '../menu/FitText';

import type { RegionTool } from '../../core/model/types';

export interface RegionSelectPanelProps {
  cellCount: number;
  onDone: () => void;
  onClear: () => void;
  tool: RegionTool;
  brushSize: number;
  onToolChange: (tool: RegionTool) => void;
  onBrushSizeChange: (size: number) => void;
}

// Just below the (repositioned) generate panel, whose card now bottoms out
// around y1407 — a small gap keeps them from touching.
const POS = { x: 526, y: 1431 };
const SIZE = { w: 1007, h: 308 };
const C = colors;

// Six brush tools — icon box + centered label, PSD-local coords.
interface Tool { tool: RegionTool; icon: string; labelKey: string; ix: number; iy: number; iw: number; ih: number; lcx: number; lcy: number; }
const TOOLS: Tool[] = [
  { tool: 'brush',  icon: 'brush-free',   labelKey: 'design.free_brush',   ix: 53,  iy: 28, iw: 88,  ih: 103, lcx: 97.5,  lcy: 158.5 },
  { tool: 'line',   icon: 'brush-line',   labelKey: 'design.line_brush',   ix: 172, iy: 29, iw: 173, ih: 99,  lcx: 258.5, lcy: 159 },
  { tool: 'curve',  icon: 'brush-curve',  labelKey: 'design.curve_brush',  ix: 357, iy: 33, iw: 126, ih: 99,  lcx: 421,   lcy: 159 },
  { tool: 'rect',   icon: 'brush-rect',   labelKey: 'design.rect_brush',   ix: 517, iy: 28, iw: 128, ih: 104, lcx: 581,   lcy: 159 },
  { tool: 'circle', icon: 'brush-circle', labelKey: 'design.circle_brush', ix: 681, iy: 29, iw: 123, ih: 108, lcx: 754,   lcy: 159 },
  { tool: 'eraser', icon: 'eraser',       labelKey: 'design.eraser',       ix: 852, iy: 33, iw: 104, ih: 99,  lcx: 904,   lcy: 159 },
];
const DOT_DIA = [24, 37, 42, 52, 60]; // green size-dot diameter for brushSize 1..5
const STEP_INK = '#CF7B68';

export function RegionSelectPanel({
  onDone, onClear, tool, brushSize, onToolChange, onBrushSizeChange,
}: RegionSelectPanelProps) {
  const t = useT();
  const { px, pxf, fw } = usePx();
  const offsetY = useMenuCenterOffset();
  const box = makeBox(px);

  const size = Math.min(5, Math.max(1, brushSize));
  const dia = DOT_DIA[size - 1] ?? 24;

  // Pill button (清除 / 完成): label centered on the PSD ink-bbox center.
  const pill = (x: number, w: number, fill: string, labelKey: string, cx: number, onClick: () => void) => (
    <motion.button type="button" onClick={onClick}
      whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }} transition={springs.stiff}
      aria-label={t(labelKey)}
      style={{ ...box(x, 207, w, 72), clipPath: squircleClip(px(w), px(72), px(34)), background: fill, border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0 }}>
      <span style={{ position: 'absolute', left: px(cx - x), top: px(37), transform: 'translate(-50%, -50%)', fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(34), color: C.white, lineHeight: 1, whiteSpace: 'nowrap' }}>{t(labelKey)}</span>
    </motion.button>
  );

  return (
    <motion.div
      style={{ position: 'fixed', left: px(POS.x), top: px(POS.y) + offsetY, width: px(SIZE.w), height: px(SIZE.h), zIndex: 150, filter: `drop-shadow(0 ${px(10)}px ${px(20)}px ${inkTint(0.22)})` }}
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 30, opacity: 0 }}
      transition={springs.bouncy}
    >
      {/* white rounded card */}
      <div style={{ position: 'absolute', inset: 0, clipPath: squircleClip(px(SIZE.w), px(SIZE.h), px(48)), background: C.white }} />

      {/* brush tools (icon + label; active = full opacity) */}
      {TOOLS.map((tl) => {
        const active = tool === tl.tool;
        return (
          <span key={tl.tool}>
            <motion.button type="button" onClick={() => onToolChange(tl.tool)}
              whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.92 }} transition={springs.stiff}
              aria-label={t(tl.labelKey)}
              style={{ ...box(tl.ix, tl.iy, tl.iw, tl.ih), background: 'none', border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0, opacity: active ? 1 : 0.5 }}>
              <img src={iconUrl(tl.icon)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </motion.button>
            <FitText cx={tl.lcx} cy={tl.lcy} maxW={150} size={26} color={C.inkText} style={{ opacity: active ? 1 : 0.55 }}>{t(tl.labelKey)}</FitText>
          </span>
        );
      })}

      {/* size stepper: yellow pill with [green dot] [+] [N] [−] */}
      <div style={{ ...box(47, 205, 282, 74), clipPath: squircleClip(px(282), px(74), px(37)), background: C.tilePaleYellow }} />
      <motion.div key={size} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={springs.bouncy}
        style={{ position: 'absolute', left: px(90 - dia / 2), top: px(244 - dia / 2), width: px(dia), height: px(dia), borderRadius: '50%', background: '#9AD573' }} />
      {/* + : two rounded bars (chunky, like the layer panel) */}
      <motion.button type="button" onClick={() => onBrushSizeChange(Math.min(5, size + 1))} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
        aria-label={t('a11y.brush_increase')}
        style={{ ...box(130, 217, 50, 50), background: 'none', border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0 }}>
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: px(50), height: px(15), borderRadius: px(8), background: STEP_INK }} />
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: px(15), height: px(50), borderRadius: px(8), background: STEP_INK }} />
      </motion.button>
      <span style={{ position: 'absolute', left: px(209.5), top: px(241.5), transform: 'translate(-50%, -50%)', fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(40), color: STEP_INK, lineHeight: 1, pointerEvents: 'none' }}>{size}</span>
      {/* − : one rounded bar */}
      <motion.button type="button" onClick={() => onBrushSizeChange(Math.max(1, size - 1))} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
        aria-label={t('a11y.brush_decrease')}
        style={{ ...box(243, 226, 50, 32), background: 'none', border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0 }}>
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: px(50), height: px(15), borderRadius: px(8), background: STEP_INK }} />
      </motion.button>

      {/* clear / done */}
      {pill(608, 157, C.tileYellow, 'generate.clear', 687, onClear)}
      {pill(799, 157, '#B8E3F0', 'generate.done', 878, onDone)}
    </motion.div>
  );
}
