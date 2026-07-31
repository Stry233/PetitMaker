/*
 * PlacementPanel.tsx — the Placement submenu, built 1:1 from the design canvas (the
 * 摆放界面 group). Shares the Build submenu's speech-bubble card (same canvas
 * spot, lower tail toward the placement tiles): header (yellow splat + category
 * icon + title), then a vertically scrollable list of the category's catalog
 * items. Flowers & tiles show 2 columns, everything
 * else 1 column; cells are placeholders until the item art is drawn.
 *
 * Wires to the catalog (getCatalogByCategory) and the existing selection state.
 */
import type { CSSProperties } from 'react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useT, localizedName } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { getCatalogByCategory } from '../../state/catalog';
import type { CatalogItem, ItemCategory } from '../../core/model/types';
import { colors, font, springs, cursors } from '../styles';
import { usePx } from './scale';
import { measureTextW } from './measure-text';
import { iconUrl } from './icons';
import { makeOutlinedTitle } from './panel-utils';
import { SpeechBubble } from './SpeechBubble';
import { SpokeShell } from './SpokeShell';
import { SplatHeader } from './SplatHeader';

// Co-located with BuildPanel (same right-of-phone slot); tail points at the
// placement grid. Positioned against the current phone card (see BuildPanel note).
const POS = { x: 632, y: 287 };
const SIZE = { h: 1056 }; // width is dynamic (sizeW)
const CARD = { x: 87, y: 73, w: 380, h: 983, r: 64 };
const TAIL = { x: 7, y: 766, w: 80, h: 96, tipPct: 56.2 };
const C = colors;

// ── Adaptive width for the header title ─────────────────────────────────────
// The title is LEFT-anchored at a fixed x (247) so the icon→title gap is
// constant, growing rightward with its text. For single-column categories the
// card stays at the PSD's fixed width (380), which is enough for en/zh/ja but
// a longer translation (e.g. th "place_facility" สิ่งอำนวยความสะดวก, fr
// "Installations") can run past the card's right edge — the title span isn't
// clipped by the card (it's a sibling, not a child), so it would float
// unclipped past the white bubble. Measure the localized title (canvas, design
// px — same technique as LayerPanel.tsx) and grow the card to fit it; the tail
// stays anchored to the phone so only the card's right edge moves.
const TITLE_X = 247, TITLE_SIZE = 35, TITLE_RIGHT_PAD = 32;
// item-label fit (design px): the cell's own padding, the grid gap, the scroll
// inset back to the card edge, a little slack, and a ceiling so a freak-long
// name can't blow the panel out.
const LABEL_SIZE = 26, CELL_PAD = 8, GRID_GAP = 18, SCROLL_INSET = 36, LABEL_SLACK = 10, MAX_CARD_W = 760;


/** category → header icon (+ its PSD center/size) + exact-PSD title key + columns. */
interface CatMeta { icon: string; titleKey: string; cols: number; cx: number; cy: number; iw: number; ih: number; }
const CAT: Record<string, CatMeta> = {
  building: { icon: 'building', titleKey: 'menu.place_building', cols: 1, cx: 160, cy: 63, iw: 107, ih: 96 },
  facility: { icon: 'facility', titleKey: 'menu.place_facility', cols: 1, cx: 160, cy: 58, iw: 102, ih: 105 },
  tree:     { icon: 'tree',     titleKey: 'menu.place_tree',     cols: 1, cx: 160, cy: 59, iw: 107, ih: 116 },
  flora:    { icon: 'flower',   titleKey: 'menu.place_flower',   cols: 2, cx: 162, cy: 63, iw: 106, ih: 106 },
  bridge:   { icon: 'bridge',   titleKey: 'menu.place_bridge',   cols: 1, cx: 160, cy: 63, iw: 110, ih: 62 },
  ramp:     { icon: 'ramp',     titleKey: 'menu.place_ramp',     cols: 1, cx: 159, cy: 74, iw: 102, ih: 73 },
};

interface Props {
  category: ItemCategory;
  selectedItemId: string | null;
  onSelectItem: (item: CatalogItem) => void;
}

export function PlacementPanel({ category, selectedItemId, onSelectItem }: Props) {
  const t = useT();
  const { px, pxf, fw } = usePx();
  const locale = useEditorStore((s) => s.locale);
  const meta = CAT[category] ?? CAT.building!;
  const items = getCatalogByCategory(category);
  const cols = meta.cols;
  const titleText = t(meta.titleKey);
  // Width adapts to the column count AND language: multi-column lists
  // (flowers/tiles) get a wider card so cells aren't cramped, and wider still for
  // the alphabetic languages (Latin/Cyrillic/Thai names run longer than the
  // compact CJK ones). Single-column categories keep the PSD width — UNLESS the
  // localized title itself needs more room (see TITLE_X/measureTextW above), in
  // which case the card widens just enough to clear it. The card grows
  // rightward (the tail stays anchored to the button); the header (badge +
  // title) stays at its fixed position regardless of width.
  const wideLabels = locale !== 'zh' && locale !== 'ja';
  const baseCardW = cols === 2 ? (wideLabels ? 560 : 490) : CARD.w;
  // Both the title AND the widest item label drive the width, so no localized
  // name (Japanese flora names run longer than the compact Chinese ones, for
  // one) gets ellipsis-clipped: measure the longest name at the label font and
  // grow the card so each column's content column fits it. Re-measured on
  // locale/category change and after the CJK webfont loads (widths shift).
  const names = items.map((it) => localizedName(it.name, locale));
  const labelKey = names.join('|');
  const widestLabel = (): number => (names.length ? Math.max(...names.map((n) => measureTextW(n, LABEL_SIZE))) : 0);
  const [titleW, setTitleW] = useState(() => measureTextW(titleText, TITLE_SIZE));
  const [labelW, setLabelW] = useState(() => widestLabel());
  useLayoutEffect(() => {
    setTitleW(measureTextW(titleText, TITLE_SIZE));
    setLabelW(widestLabel());
  }, [titleText, labelKey]);
  useEffect(() => {
    const fonts = (document as { fonts?: { ready: Promise<unknown> } }).fonts;
    let alive = true;
    fonts?.ready.then(() => { if (alive) { setTitleW(measureTextW(titleText, TITLE_SIZE)); setLabelW(widestLabel()); } });
    return () => { alive = false; };
  }, [titleText, labelKey]);
  const minCardWForTitle = TITLE_X + titleW + TITLE_RIGHT_PAD - CARD.x;
  // width the scroll body needs for the widest label to fit without clipping:
  // per-column content = label + the cell's own left/right padding, plus the
  // inter-column gaps, plus the scroll inset back out to the card edge.
  const minCardWForLabels = cols * (labelW + 2 * CELL_PAD + LABEL_SLACK) + (cols - 1) * GRID_GAP + SCROLL_INSET;
  const cardW = Math.min(MAX_CARD_W, Math.max(baseCardW, minCardWForTitle, minCardWForLabels));
  const sizeW = CARD.x + cardW + 2;
  const scrollW = cardW - 36;

  const outlinedTitle = makeOutlinedTitle(px, pxf, fw);

  // scroll viewport inside the card body — starts below the header badge
  // (splat + category icon reach ~y132) so the first row never sits under it.
  const scroll: CSSProperties = {
    position: 'absolute', left: px(105), top: px(150), width: px(scrollW), height: px(887),
    overflowY: 'auto', overflowX: 'hidden', display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: px(18), alignContent: 'start',
    padding: `0 ${px(4)}px`,
  };
  // Taller cells + a wider icon→label gap so the (full-height) sprites never
  // crowd the label beneath them.
  const cellH = cols === 2 ? px(188) : px(202);

  return (
    <SpokeShell x={POS.x} y={POS.y} width={sizeW} height={SIZE.h} origin="1.5% 77.6%">
      <SpeechBubble px={px} tail={{ x: TAIL.x, y: TAIL.y, w: TAIL.w, h: TAIL.h, tipPct: TAIL.tipPct }} card={{ x: CARD.x, y: CARD.y, w: cardW, h: CARD.h, r: CARD.r }} />

      {/* header: yellow splat + category icon + title (only the title is outlined) */}
      <SplatHeader px={px} icon={meta.icon} cx={meta.cx} cy={meta.cy} iw={meta.iw} ih={meta.ih} />
      {/* title is LEFT-anchored (not centered) so the icon→first-character gap
          is identical across categories/languages, regardless of title width. */}
      <span style={outlinedTitle(TITLE_X, 75, TITLE_SIZE, C.frameDark)}>{titleText}</span>

      {/* scrollable item list (placeholder cells until item art is drawn) */}
      <div style={scroll}>
        {items.map((item) => {
          const selected = selectedItemId === item.id;
          return (
            <motion.button key={item.id} type="button" onClick={() => onSelectItem(item)}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }} transition={springs.stiff}
              style={{
                height: cellH, width: '100%', borderRadius: px(28), border: 'none', appearance: 'none',
                cursor: cursors.clickable, background: C.panelCream, padding: px(8),
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: px(12),
                position: 'relative',
                WebkitTapHighlightColor: 'transparent',
              }}>
              {/* Selection ring eases in from center on select. Persistent
                  while selected (static state); the entrance marks the transition.
                  Reduced-motion is handled globally via <MotionConfig> in App. */}
              {selected && (
                <motion.div
                  initial={{ scale: 0.82, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  // Ease-out (NOT a bouncy spring): the ring must never scale past
                  // its rest size or it gets clipped by the scroll container.
                  // Inset a few px so it sits clear of the cell edge.
                  transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                  style={{ position: 'absolute', inset: px(3), borderRadius: px(26), border: `${px(6)}px solid ${C.tileYellow}`, pointerEvents: 'none' }}
                />
              )}
              {item.icon && iconUrl(item.icon)
                ? <img src={iconUrl(item.icon)} alt="" draggable={false} style={{ width: cols === 2 ? px(120) : px(128), height: cols === 2 ? px(120) : px(128), objectFit: 'contain' }} />
                : item.color
                  ? <span style={{ width: cols === 2 ? px(56) : px(80), height: cols === 2 ? px(56) : px(80), borderRadius: px(12), background: item.color, border: `2px solid ${colors.inkBorder}` }} />
                  : null}
              <span style={{ fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(26), color: C.inkText, lineHeight: 1.35, maxWidth: '100%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {localizedName(item.name, locale)}
              </span>
            </motion.button>
          );
        })}
        {items.length === 0 && (
          <span style={{ ...font.body, gridColumn: '1 / -1', textAlign: 'center', color: C.textSecondary, padding: px(40) }}>-</span>
        )}
      </div>
    </SpokeShell>
  );
}
