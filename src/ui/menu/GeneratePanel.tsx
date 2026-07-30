/*
 * GeneratePanel.tsx — the Generate screen, built 1:1 from the design canvas
 * (the Generate group, canvas 705,237, size 889x1300). A white rounded
 * card with: planet/title header, Random/Maze algorithm pills, Mountain/River/
 * Earth terrain toggles, Relief + Max Height sliders, Seed + dice,
 * Whole-Map/Select-Region scope, and Generate/Clear actions.
 *
 * Pops up like a comic speech bubble FROM the phone (the home card stays
 * visible) — the pop animation originates from the phone's direction. All
 * coordinates are raw PSD px (relative to the Generate group); text is centered
 * on each element's PSD ink-bbox center so it sits exactly where the PSD has it.
 * Corners use the same figma-squircle as the rest of the UI. Wires to the
 * generation handlers passed from App (preview / generate / clear + region select).
 */
import { useState, Fragment, lazy, Suspense, type Dispatch, type SetStateAction } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../i18n/context';
import { colors, inkTint, font, springs, btnReset, exitTransition, cursors } from '../styles';
import { usePx, useMenuCenterOffset, ScaleProvider, useContentScale } from './scale';
import { useUiZooming } from './ui-zoom-anim';
import { squircleClip } from './squircle';
import { iconUrl } from './icons';
import { FitText } from './FitText';
import { makeBox, makeCtext, makeIconImg, makeOutlinedTitle } from './panel-utils';
import { SpeechBubble } from './SpeechBubble';
import { Slider } from './Slider';
import { useSpringState } from '../hooks/useSpringState';
import type { GenerateConfig, GenerateAlgorithm, MacroCoord } from '../../core/model/types';
import { ELEVATION_MAX } from '../../core/model/constants';
import { LoadingDots } from './LoadingDots';

/* The agent section pulls in the LLM SDKs (@anthropic-ai/sdk, openai) — lazy-load
 * it so that weight stays out of the main bundle until agent mode is opened. */
const AgentSection = lazy(() => import('./agent/SiteLogSection').then((m) => ({ default: m.SiteLogSection })));
/** Agent section height in PSD px (settings strip + chat + context + input + footer)
 *  — drives the card height. 1170 keeps the card bottom (~1363 panel px) under the
 *  historic ~1407 limit that leaves room for the region-brush panel below. */
const AGENT_BLOCK_H = 1100;

// Positioned against the phone card (not the raw design-source coordinate):
// x shifted so the tail overlaps the phone, y set so the tail points at the
// generate tile (grid row 2) and the card bottom (~1407) leaves room for the
// region-brush panel below.
const POS = { x: 632, y: 109 };
const SIZE = { w: 889, h: 1300 };
// Speech-bubble body (PSD-measured: inset on the left, with a tail pointing
// left toward the Generate button on the phone).
const CARD = { x: 88, y: 101, w: 799, h: 1197, r: 64 }; // r matches the other cards (card shape is drawn pre-scaled, see sCard)
const TAIL = { x: 7, y: 994, w: 81, h: 96, tipPct: 57.3 }; // left-pointing triangle
// The design source authors Generate ~1.4x larger than the other spokes. Scale only the
// CONTENT (card + controls) so its elements match Build/Placement; the tail stays
// standard size (rendered outside this wrapper). The content renders NATIVELY at
// `inner = scale × CONTENT_SCALE` under a translated wrapper (no CSS scale transform —
// that rasterized then GPU-downscaled the content, blurry at DPR 1); the translation
// origin = (CARD.x, TIP_Y) keeps the card's LEFT edge pinned at CARD.x so the tail meets it.
// See the `inner`/`innerOffset` derivation in the component for the exact geometry.
const CONTENT_SCALE = 0.7;
const TIP_Y = TAIL.y + (TAIL.tipPct / 100) * TAIL.h; // tail tip / button anchor
// The card is drawn at its already-scaled size (CONTENT_SCALE math, matching the content's
// native scale) so it can share ONE shadow caster with the standard-size tail. Its HEIGHT is
// dynamic (the Advanced section grows it) — see `dynCard` in the component.
const C = colors;

/* Algorithm pills: icon center + text center (PSD ink-bbox centers).
 * Widened from the PSD's 264 to 340: "Random" (the widest label, 220px @ fs53)
 * doesn't fit beside the icon in 264, so rather than shrink it the pills grow
 * rightward — the noise pill keeps the x172 grid line (shared by the sliders/
 * terrain/seed) and the maze pill stops short of the card's right edge. Icons
 * keep their PSD positions (ic[0]-px); the label fills the reclaimed space.
 * Chinese (随机/迷宫, 104px) was already comfortable. */
/* Mode selector: an expandable 3-button group in the same gutter the two PSD
 * pills occupied (x172..876). The ACTIVE mode stretches (flex 1) and shows its
 * label; inactive modes collapse to icon squares. `layout` animates the width
 * with springs.gentle (the panel's collapse family); labels mount/unmount via
 * AnimatePresence. Squircle clips would distort while width animates, so these
 * buttons use a plain border radius (28, the algorithm pills' corner). */
type PanelMode = GenerateAlgorithm | 'agent';
const MODES: { id: PanelMode; fill: string; icon: string; iw: number; ih: number; labelKey: string }[] = [
  { id: 'random', fill: colors.sliderYellow, icon: 'random', iw: 88, ih: 99, labelKey: 'generate.algo_noise' },
  { id: 'maze', fill: colors.tileModeOrange, icon: 'maze', iw: 101, ih: 84, labelKey: 'generate.algo_maze' },
  { id: 'agent', fill: colors.tileModeGreen, icon: 'agent', iw: 88, ih: 88, labelKey: 'generate.algo_agent' },
];
/* The row sits on the panel's content COLUMN (x172..800 — the slider-track grid),
 * not the design source's two-pill span (..876): the card body runs 88..887, so
 * 172..800 gives near-symmetric margins (~84/87 design px) while ..876 would
 * leave only ~11px on the right. */
const MODE_ROW = { x: 172, y: 167, w: 628, h: 124, gap: 20, square: 124, r: 28 };
/** The clip container for the agent section starts here — below the mode row —
 *  so it never covers the mode-selector buttons. */
const CLIP_TOP = MODE_ROW.y + MODE_ROW.h;

/** Label font size that fits the active pill across locales (CJK counts double).
 *  Cap 50 ~ the PSD pills' fs 53; long labels (AIエージェント) scale down to fit. */
function modeLabelSize(label: string): number {
  const vlen = [...label].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return Math.min(50, Math.floor(430 / Math.max(vlen, 1)));
}

function ModeIcon({ icon, iw, ih, px }: { icon: string; iw: number; ih: number; px: (n: number) => number }) {
  return <img src={iconUrl(icon)} alt="" draggable={false} style={{ width: px(iw), height: px(ih), objectFit: 'contain', flexShrink: 0 }} />;
}

/** Mode-selector row: the ACTIVE mode expands to icon+label, inactive modes
 *  collapse to icon squares. Rendered under the content ScaleProvider so it takes
 *  the inner px helpers (ipx/ipxf/ifw). See the MODE_ROW note above. */
function ModeSelector({
  panelMode, setPanelMode, reduced, zooming, ipx, ipxf, ifw, t,
}: {
  panelMode: PanelMode;
  setPanelMode: Dispatch<SetStateAction<PanelMode>>;
  reduced: boolean | null;
  zooming: boolean;
  ipx: (n: number) => number;
  ipxf: (n: number) => number;
  ifw: (w: number) => number;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div style={{ position: 'absolute', left: ipx(MODE_ROW.x), top: ipx(MODE_ROW.y), width: ipx(MODE_ROW.w), height: ipx(MODE_ROW.h), display: 'flex', gap: ipx(MODE_ROW.gap) }}>
      {MODES.map((m) => {
        const active = panelMode === m.id;
        const label = t(m.labelKey);
        return (
          <motion.button key={m.id} type="button" onClick={() => setPanelMode(m.id)}
            /* Animate the real `width` property (NOT `layout`): layout animations
             * run on scale transforms, which warp the corner radius and stretch
             * the icon mid-flight. Width keeps geometry rigid; the icon is
             * anchored at a fixed left inset so nothing jumps as space grows. */
            initial={false}
            animate={{ width: ipx(active ? MODE_ROW.w - 2 * (MODE_ROW.square + MODE_ROW.gap) : MODE_ROW.square), opacity: active ? 1 : 0.5 }}
            transition={reduced || zooming ? { duration: 0 } : springs.stiff}
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
            aria-label={label} aria-pressed={active}
            style={{ position: 'relative', height: '100%', flex: '0 0 auto', borderRadius: ipx(MODE_ROW.r), background: m.fill, border: 'none', appearance: 'none', cursor: cursors.clickable, padding: `0 0 0 ${ipx((MODE_ROW.square - m.iw) / 2)}px`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
            <ModeIcon icon={m.icon} iw={m.iw} ih={m.ih} px={ipx} />
            <AnimatePresence initial={false}>
              {active && (
                <motion.span key="label"
                  initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.06, duration: 0.15 } }}
                  exit={{ opacity: 0, transition: exitTransition }}
                  style={{ flex: 1, textAlign: 'center', paddingRight: ipx(16), fontFamily: font.family, fontWeight: ifw(900), fontSize: ipxf(modeLabelSize(label)), color: C.white, whiteSpace: 'nowrap' }}>
                  {label}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}
    </div>
  );
}
const TERRAIN: { id: 'earth' | 'water' | 'mixed'; x: number; fill: string; icon: string; iw: number; ih: number }[] = [
  { id: 'earth', x: 172, fill: colors.tileYellow, icon: 'mountain', iw: 128, ih: 128 },
  { id: 'water', x: 408, fill: colors.tileGreen, icon: 'river', iw: 128, ih: 95 },
  { id: 'mixed', x: 644, fill: '#B8E3F0', icon: 'earth', iw: 133, ih: 110 },
];
// Two action buttons — Generate + Clear — centered in the content column. Each button is 175
// wide; these x's keep the pair symmetric about the panel centre with the standard 53px gutter.
const ACTIONS: { id: string; x: number; fill: string; labelKey: string }[] = [
  { id: 'generate', x: 285, fill: colors.tileGreen, labelKey: 'scatter.commit' },
  { id: 'clear', x: 513, fill: colors.tileYellow, labelKey: 'generate.clear' },
];

interface Props {
  region: MacroCoord[];
  regionSize: number;
  isSelecting: boolean;
  generating: boolean;
  onSelectRegion: () => void;
  onClearRegion: () => void;
  onGenerate: (config: GenerateConfig) => void;
  onClear: () => void;
}

interface GenerateControlsProps {
  t: ReturnType<typeof useT>;
  ipx: (n: number) => number;
  ipxf: (n: number) => number;
  ifw: (w: number) => number;
  box: ReturnType<typeof makeBox>;
  ctext: ReturnType<typeof makeCtext>;
  iconImg: ReturnType<typeof makeIconImg>;
  sliderRows: { key: string; label: string; value: number; min: number; max: number; set: (v: number) => void }[];
  FIRST_TRACK: number;
  SLIDER_PITCH: number;
  LABEL_DY: number;
  seedTop: number;
  scopeY: number;
  seed: number;
  setSeed: (v: number) => void;
  seedFontSize: number;
  showRecipeHelp: boolean;
  setShowRecipeHelp: Dispatch<SetStateAction<boolean>>;
  selectRegionActive: boolean;
  onClearRegion: () => void;
  onSelectRegion: () => void;
}

/** The Random/Maze control stack (sliders + recipe id + scope), rendered when
 *  NOT in agent mode. Geometry (FIRST_TRACK / seedTop / scopeY) is computed by
 *  the parent from the collapse spring + slider count so the vertical rhythm
 *  stays uniform; this component only lays the controls out at those positions. */
function GenerateControls({
  t, ipx, ipxf, ifw, box, ctext, iconImg, sliderRows, FIRST_TRACK, SLIDER_PITCH, LABEL_DY,
  seedTop, scopeY, seed, setSeed, seedFontSize, showRecipeHelp, setShowRecipeHelp,
  selectRegionActive, onClearRegion, onSelectRegion,
}: GenerateControlsProps) {
  return (
    <>
      {/* slider stack — evenly spaced via SLIDER_PITCH. random: naturalness + max-height; maze: corridor +
          max-height. (Water/Settlement/Nature density are mode/default-driven, not sliders.) */}
      {sliderRows.map((r, i) => {
        const trackY = FIRST_TRACK + i * SLIDER_PITCH;
        return (
          <Fragment key={r.key}>
            <span style={{ ...ctext(489, trackY - LABEL_DY, 40, C.inkText), opacity: r.min === r.max ? 0.4 : 1 }}>{r.label}</span>
            <Slider y={trackY} value={r.value} min={r.min} max={r.max} onChange={r.set} disabled={r.min === r.max} />
          </Fragment>
        );
      })}

      {/* recipe id (formerly "seed"): left-anchored label + a help "?" in a flex row, below the
          slider stack. The value box is shifted right to clear the wider label. */}
      <div style={{ position: 'absolute', left: ipx(172), top: ipx(seedTop + 44), transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: ipx(14) }}>
        <span style={{ fontFamily: font.family, fontWeight: ifw(900), fontSize: ipxf(40), color: C.inkText, lineHeight: 1, whiteSpace: 'nowrap', userSelect: 'none' }}>{t('generate.recipe_id')}</span>
        <motion.button type="button" onClick={() => setShowRecipeHelp((v) => !v)}
          whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} transition={springs.stiff} aria-label={t('generate.recipe_help')}
          style={{ width: ipx(46), height: ipx(46), borderRadius: '50%', background: showRecipeHelp ? C.frameDark : '#C8C8C8', color: showRecipeHelp ? C.white : C.frameDark, border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: font.family, fontWeight: ifw(900), fontSize: ipxf(30), lineHeight: 1 }}>?</motion.button>
      </div>
      <div style={{ ...box(430, seedTop, 230, 89), clipPath: squircleClip(ipx(230), ipx(89), ipx(42)), background: '#C8C8C8' }} />
      <input type="text" inputMode="numeric" maxLength={10} value={String(seed)}
        onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 10); setSeed(d ? Number(d) : 0); }}
        aria-label={t('generate.recipe_id')}
        style={{ position: 'absolute', left: ipx(430), top: ipx(seedTop), width: ipx(230), height: ipx(89), boxSizing: 'border-box', padding: `0 ${ipx(12)}px`, background: 'transparent', border: 'none', outline: 'none', textAlign: 'center', ...font.body, fontWeight: ifw(900), fontSize: ipxf(seedFontSize), color: C.inkText, cursor: cursors.text }} />
      <motion.button type="button" onClick={() => setSeed(Math.floor(Math.random() * 100000))}
        aria-label={t('generate.recipe_id')} whileHover={{ scale: 1.08, rotate: 8 }} whileTap={{ scale: 0.9 }} transition={springs.stiff}
        style={{ ...box(680, seedTop - 16, 132, 130), ...btnReset }}>
        <img src={iconUrl('dice')} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </motion.button>

      {/* help popover — toggled by the "?"; a transparent backdrop dismisses it on any click. */}
      {showRecipeHelp && (
        <>
          <div onClick={() => setShowRecipeHelp(false)} style={{ position: 'absolute', inset: 0, zIndex: 8, cursor: cursors.default }} />
          <motion.div initial={{ opacity: 0, y: ipx(-8) }} animate={{ opacity: 1, y: 0 }} transition={springs.stiff}
            onClick={() => setShowRecipeHelp(false)}
            style={{ position: 'absolute', left: ipx(172), top: ipx(seedTop + 98), width: ipx(560), zIndex: 10, background: C.frameDark, color: C.white, borderRadius: ipx(28), padding: `${ipx(22)}px ${ipx(28)}px`, fontFamily: font.family, fontWeight: 700, fontSize: ipxf(28), lineHeight: 1.45, boxShadow: `0 ${ipx(6)}px ${ipx(18)}px ${inkTint(0.32)}`, cursor: cursors.clickable }}>
            {t('generate.recipe_help')}
          </motion.div>
        </>
      )}

      {/* scope */}
      <motion.button type="button" onClick={onClearRegion} aria-label={t('generate.entire_map')}
        whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.94 }} transition={springs.stiff}
        style={{ ...box(268, scopeY, 156, 158), ...btnReset, opacity: selectRegionActive ? 0.45 : 1 }}>
        <img src={iconUrl('whole-map')} alt="" draggable={false} style={iconImg(9, 0, 138, 115)} />
        {/* These scope buttons have NO pill, so the label isn't bound to the
            icon width — it centers under the icon and may extend into the gap
            between the two buttons (their centers are 270px apart). 268 lets
            "Select Region" (265) sit at full size without overlapping. */}
        <FitText cx={78} cy={158 - 18} maxW={268} size={40} color={C.inkText}>{t('generate.entire_map')}</FitText>
      </motion.button>
      <motion.button type="button" onClick={onSelectRegion} aria-label={t('generate.select_region')}
        whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.94 }} transition={springs.stiff}
        style={{ ...box(537, scopeY - 16, 159, 174), ...btnReset, opacity: selectRegionActive ? 1 : 0.55 }}>
        <img src={iconUrl('select-region')} alt="" draggable={false} style={iconImg(10, 0, 138, 125)} />
        <FitText cx={79} cy={174 - 18} maxW={268} size={40} color={C.inkText}>{t('generate.select_region')}</FitText>
      </motion.button>
    </>
  );
}

/** Vertical-rhythm layout for the Random/Maze control stack + the springing card
 *  height. Geometry (FIRST_TRACK / seedTop / scopeY / actionsY) is COMPUTED from
 *  the collapse spring + slider count so the vertical rhythm stays uniform and the
 *  bottom gap is always consistent (no magic per-section offsets). Returns the
 *  positions the JSX consumes plus the springing agent-clip height + the dynamic
 *  card rect. `ipx` is the content-scaled px used to convert the clip height. */
function useGenerateLayout({
  collapse, isAgent, sliderRowCount, reduced, ipx,
}: {
  collapse: number;
  isAgent: boolean;
  sliderRowCount: number;
  reduced: boolean | null;
  ipx: (n: number) => number;
}) {
  // Inline slider stack (no collapsible Advanced — removed). Even spacing via shared tokens, and the
  // seed/scope/actions positions + card height are COMPUTED from the stack so the rhythm is uniform
  // and the bottom gap is always consistent (no magic per-section offsets).
  const SLIDER_PITCH = 152;   // track-to-track
  const LABEL_DY = 39;        // label sits above its track
  const FIRST_TRACK = 573 - collapse; // y of the first slider track (slides up when the mode row collapses)
  const TRACK_H = 34;
  const SECTION_GAP = 92;     // gap after the slider stack, and after the seed block
  const slidersBottom = FIRST_TRACK + (sliderRowCount - 1) * SLIDER_PITCH + TRACK_H;
  const seedTop = slidersBottom + SECTION_GAP;          // top of the recipe/seed value box (slider→seed gap)
  // The seed row's content extends 114 below seedTop (the dice button); the taller scope button starts 16
  // above scopeY; the scope row ends 158 below scopeY. ROW_GAP is the SAME gap below the seed row and below
  // the scope row, so the recipe→scope and scope→actions spacings match.
  const ROW_GAP = 32;
  const scopeY = seedTop + 114 + ROW_GAP + 16;
  const actionsY = scopeY + 158 + ROW_GAP + 30;          // a little extra padding scope→actions (card floor keeps the maze tail attached)
  // The action buttons sit at actionsY, which already springs (via `collapse`) on a
  // maze↔random switch. The card bottom must move in LOCKSTEP with them, or the
  // buttons spill past the card's rounded bottom mid-animation. So for the non-agent
  // modes the card bottom is actionsY + padding DIRECTLY — a second spring chasing a
  // moving target would lag in series and open exactly that gap. Agent mode is a big
  // jump the `collapse` spring doesn't cover, so we spring a 0→1 progress and
  // interpolate the bottom between the live non-agent bottom and the tall agent
  // bottom (collapse is settled during an agent toggle, so the non-agent end is
  // effectively constant and the morph reads as one gentle spring).
  const nonAgentBottom = actionsY + 80 + 40;                        // action height + bottom padding
  const agentBottom = MODE_ROW.y + MODE_ROW.h + 37 + AGENT_BLOCK_H; // full chat block
  const [agentP] = useSpringState(isAgent ? 1 : 0, springs.gentle, reduced);
  const contentBottom = nonAgentBottom + (agentBottom - nonAgentBottom) * agentP;
  // Clip height for the agent block: CLIP_TOP → the card bottom, so the clip container
  // (which starts below the mode row) never paints outside the card. A plain number:
  // both springs mirror to state each frame, so this recomputes per frame already.
  const clipHeight = ipx(Math.max(0, contentBottom - CLIP_TOP));
  // Card height has a floor so the bubble always reaches its tail: when maze collapses the panel the
  // computed height drops below where the tail attaches, detaching the triangle from the rounded card.
  const MIN_CARD_H = 790;
  const dynCard = { x: CARD.x, y: TIP_Y + (CARD.y - TIP_Y) * CONTENT_SCALE, w: CARD.w * CONTENT_SCALE, h: Math.max((contentBottom - CARD.y) * CONTENT_SCALE, MIN_CARD_H), r: CARD.r };
  return { SLIDER_PITCH, LABEL_DY, FIRST_TRACK, seedTop, scopeY, actionsY, clipHeight, dynCard };
}

export function GeneratePanel({
  region, regionSize, isSelecting, generating,
  onSelectRegion, onClearRegion, onGenerate, onClear,
}: Props) {
  const t = useT();
  const { px, fw } = usePx();
  const offsetY = useMenuCenterOffset();
  // The design source authors Generate ~1.4x larger than the other spokes, so its CONTENT
  // (card + controls) renders at CONTENT_SCALE the outer scale via NATIVE scaling
  // (see the `useContentScale` derivation): inner px helpers + the non-scaling
  // wrapper offset that keeps the card's LEFT edge pinned so the tail meets it.
  const { inner, ipx, ipxf, ifw, innerOffset } = useContentScale(CONTENT_SCALE, { x: CARD.x, y: TIP_Y });
  const zooming = useUiZooming();
  const reduced = useReducedMotionConfig();
  const [panelMode, setPanelMode] = useState<PanelMode>('random');
  const algorithm: GenerateAlgorithm = panelMode === 'agent' ? 'random' : panelMode;
  const isAgent = panelMode === 'agent';
  const [mode, setMode] = useState<'earth' | 'water' | 'mixed'>('earth');
  const [naturalness, setNaturalness] = useState(100);
  const [corridorWidth, setCorridorWidth] = useState(1);
  const [maxElevation, setMaxElevation] = useState(8);
  const [seed, setSeed] = useState(42);
  const [showRecipeHelp, setShowRecipeHelp] = useState(false);

  const isMaze = panelMode === 'maze';
  const effMaxElev = isMaze ? 3 : mode === 'water' ? 1 : ELEVATION_MAX; // earth/mixed reach the real ceiling; maze mountain-only (cap 3)

  // Maze is mountain-only, so the earth/water/mixed mode row doesn't apply: collapse it away. The collapse
  // is a spring-driven value (same family as the panel's other motion) — the sliders/seed/scope/actions
  // below slide up by `collapse` and the card shrinks to match, in step with the tiles fading out.
  const MODE_BLOCK = 160; // how far the panel slides up in maze — < the full tile row, so the sliders keep a comfortable gap below the algorithm pills (not crowded against the corridor label)
  // Always animates (no reduced-motion jump in the original); only the state mirror is read below,
  // so the underlying MotionValue is discarded.
  const [collapse] = useSpringState(isMaze ? MODE_BLOCK : 0, springs.gentle);

  // Build config. The terrain MODE (earth/water/mixed) + Naturalness + Max-Height are the only knobs;
  // water amount, settlement and nature density are entangled (no clean independent control), so they are
  // not sliders — toGenConfig supplies sensible internal defaults (water from the mode, settlement/nature
  // 0.5, relief 0.8). Naturalness 100 = the organic classic look; 0 = rectilinear "lego" terrain + roads.
  const config: GenerateConfig = {
    algorithm, mode, corridorWidth,
    maxElevation: Math.min(maxElevation, effMaxElev), seed, region: null,
    naturalness: naturalness / 100,
  };
  const dim = generating ? { opacity: 0.5, pointerEvents: 'none' as const } : {};
  // Recipe id is user-editable; its font shrinks to fit the fixed value box so a
  // long id never widens the UI (<=8 digits stay full size at fs40 — 8 nines is
  // ~191px in the ~206px-wide box; beyond that the size scales down by length).
  const seedFontSize = Math.min(40, Math.floor(320 / Math.max(1, String(seed).length)));

  // These helpers are used only INSIDE the content wrapper, so bind them to the
  // inner px (native CONTENT_SCALE rendering — see the `inner` derivation above).
  const box = makeBox(ipx);
  const ctext = makeCtext(ipx, ipxf, ifw);
  const iconImg = makeIconImg(ipx);
  // Title uses the OUTER-scale fw (not ifw) — see the title span below.
  const outlinedTitle = makeOutlinedTitle(ipx, ipxf, fw);


  const selectRegionActive = isSelecting || regionSize > 0;
  const onAction = (id: string) => {
    if (generating) return;
    if (id === 'generate') onGenerate(config);
    else onClear();
  };

  // slider stack rows — random: naturalness + max-height; maze: corridor + max-height. (Water/Settlement/
  // Nature density are mode/default-driven, not sliders.) Their COUNT drives the vertical rhythm below.
  const sliderRows: { key: string; label: string; value: number; min: number; max: number; set: (v: number) => void }[] = isMaze
    ? [
        { key: 'corridor', label: t('generate.corridor'), value: corridorWidth, min: 1, max: 3, set: setCorridorWidth },
        { key: 'maxElev', label: t('generate.max_elev'), value: Math.min(maxElevation, effMaxElev), min: 1, max: effMaxElev, set: setMaxElevation },
      ]
    : [
        { key: 'naturalness', label: t('generate.naturalness'), value: naturalness, min: 0, max: 100, set: setNaturalness },
        // Terrain modes (earth/mixed) allow 0 = a completely flat map; water mode stays pinned
        // (min===max===1, so the slider is disabled) since its islands are flat by construction.
        { key: 'maxElev', label: t('generate.max_elev'), value: Math.min(maxElevation, effMaxElev), min: mode === 'water' ? effMaxElev : 0, max: effMaxElev, set: setMaxElevation },
      ];
  const { SLIDER_PITCH, LABEL_DY, FIRST_TRACK, seedTop, scopeY, actionsY, clipHeight, dynCard } =
    useGenerateLayout({ collapse, isAgent, sliderRowCount: sliderRows.length, reduced, ipx });

  return (
    <motion.div
      // The box is the full PSD canvas but the bubble fills only ~CONTENT_SCALE of it, so the rest is
      // transparent margin. pointerEvents:none here lets those margins pass clicks through (e.g. the
      // 3D-preview button on the layer panel behind); the SpeechBubble shapes + content column below
      // re-enable hit-testing on the visible bubble.
      style={{ position: 'fixed', left: px(POS.x), top: px(POS.y) + offsetY, width: px(SIZE.w), height: px(SIZE.h), zIndex: 110, transformOrigin: '0.8% 80.7%', pointerEvents: 'none' }}
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.4, opacity: 0, transition: exitTransition }}
      transition={springs.bouncy}
    >
      {/* ONE caster: the standard-size tail + the pre-scaled card (sCard) share a
          single drop-shadow (separate casters made the card's shadow hit the tail). */}
      <SpeechBubble px={px} tail={{ x: TAIL.x, y: TAIL.y, w: TAIL.w, h: TAIL.h, tipPct: TAIL.tipPct }} card={dynCard} />

      {/* CONTENT (controls only — the card lives in the caster above) rendered at
          CONTENT_SCALE the outer scale to match the other spokes. NATIVE scaling
          (no CSS transform): a non-scaling wrapper translated by origin·(1−scale)
          (see the `inner`/`innerOffset` derivation above) hosts children under a
          ScaleProvider at `inner`, so every glyph/icon rasterizes at its true
          pixel size (crisp at DPR 1). Children keep design-absolute PSD coords.
          Not a drop-shadow caster, so hovering icons never shadow their PNG box. */}
      <ScaleProvider value={inner}>
      {/* Re-enable hit-testing, but only across the CARD column (not the transparent right margin where
          the layer panel's 3D button sits) — so controls work and the visible card blocks clicks,
          while the margin stays click-through (root is pointerEvents:none). */}
      <div style={{ position: 'absolute', left: innerOffset.left, top: innerOffset.top, width: px(CARD.x + CARD.w * CONTENT_SCALE + 20) - innerOffset.left, height: '100%', pointerEvents: 'auto' }}>

      {/* header: planet + soft blue cloud (extracted decoration) + native title.
          The title has an 8px white OUTER stroke (a PSD layer effect). Applied as
          a white outline span (fill+stroke white, so it dilates ~8px) behind the
          dark fill span — reliable across browsers, unlike a centered text-stroke
          which erodes the glyph. */}
      <img src={iconUrl('gen-header')} alt="" draggable={false} style={iconImg(123, 0, 205, 159)} />
      {/* left-anchored title — consistent icon->title gap across languages */}
      {/* Title weight uses the OUTER-scale fw (not ifw): this title renders at the
          same on-screen size as the other spokes' titles (PSD-50 x CONTENT_SCALE =
          others' PSD-35 x scale), so the heavy-weight cap must key off `scale` like
          they do — keying off `inner` over-capped it to 600 and made it look thin. */}
      <span style={outlinedTitle(341, 102, 50, C.frameDark)}>{t('menu.generate')}</span>

      <div style={{ ...dim, position: 'absolute', inset: 0 }}>
        {/* mode selector: active pill expands to icon+label, inactive collapse to icon squares */}
        <ModeSelector panelMode={panelMode} setPanelMode={setPanelMode} reduced={reduced} zooming={zooming} ipx={ipx} ipxf={ipxf} ifw={ifw} t={t} />

        {/* AI Agent mode: settings + chat replace the whole Random/Maze stack.
            AnimatePresence drives the exit fade; the clip container starts BELOW
            the mode row so it never occludes the mode pills, and uses a
            coordinate-restoring inner div so AgentSection coordinates stay in the
            panel's own PSD space. No pointerEvents on the clip — default auto is
            correct since the clip sits entirely below the mode row.
            transient double-mount on fast mode toggles is benign (exiting instance
            fades while the new one mounts; stores are external singletons).
            Exit standard: exitTransition (0.16s ease-out [0.4,0,0.2,1]) — a quick
            settle so content disappears before the card finishes shrinking. This is
            the same token every other spoke panel uses (BuildPanel, PlacementPanel,
            GeneratePanel main wrapper) — springs overshoot on exit inside
            AnimatePresence so exits use a short ease-out tween instead. */}
        <AnimatePresence>
          {isAgent && (
            <motion.div
              key="agent-clip"
              initial={reduced ? false : { opacity: 0, y: ipx(18) }}
              animate={{ opacity: 1, y: 0, transition: springs.gentle }}
              exit={{ opacity: 0, transition: exitTransition }}
              style={{
                position: 'absolute',
                top: ipx(CLIP_TOP),
                left: ipx(CARD.x),
                width: ipx(CARD.w),
                height: clipHeight,
                overflow: 'hidden',
              }}
            >
              {/* Restore coordinates: shift back up by CLIP_TOP and left by CARD.x so
                  children keep the full panel PSD coordinate space. The clip hugs the
                  CARD bounds (not the panel) so the setup/chat slide stays inside the
                  white card instead of jutting past its edges. */}
              <div style={{ position: 'absolute', left: ipx(-CARD.x), width: ipx(SIZE.w), top: ipx(-CLIP_TOP), height: ipx(MODE_ROW.y + MODE_ROW.h + 37 + AGENT_BLOCK_H) }}>
                <Suspense fallback={null}>
                  <AgentSection top={MODE_ROW.y + MODE_ROW.h + 37} region={region}
                    isSelecting={isSelecting} onSelectRegion={onSelectRegion} onClearRegion={onClearRegion} />
                </Suspense>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* terrain toggles — maze is mountain-only, so this whole row pops out (bouncy, staggered one-by-one)
            while Maze is selected and the sliders below slide up into its place (the `collapse` spring). */}
        <AnimatePresence>
          {!isMaze && !isAgent && TERRAIN.map((tr, i) => (
            <motion.button key={tr.id} type="button" onClick={() => setMode(tr.id)}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: mode === tr.id ? 1 : 0.45, scale: 1, transition: { ...springs.bouncy, delay: i * 0.06 } }}
              exit={{ opacity: 0, scale: 0.5, transition: { ...springs.bouncy, delay: i * 0.06 } }}
              transition={springs.stiff} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.94 }}
              style={{ ...box(tr.x, 328, 157, 157), clipPath: squircleClip(ipx(157), ipx(157), ipx(37)), background: tr.fill, border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src={iconUrl(tr.icon)} alt="" draggable={false} style={{ width: ipx(tr.iw), height: ipx(tr.ih), objectFit: 'contain' }} />
            </motion.button>
          ))}
        </AnimatePresence>

        {/* Random/Maze stack (sliders/seed/scope) — swaps with the agent block.
            The wrapper is hit-transparent (.pw-hitpass restores its children) so
            the whole absolutely-positioned group fades/rises as one element,
            mirroring the agent side: springs.gentle in, exitTransition out. */}
        <AnimatePresence initial={false}>
          {!isAgent && (
            <motion.div
              key="gen-stack"
              className="pw-hitpass"
              initial={reduced ? false : { opacity: 0, y: ipx(18) }}
              animate={{ opacity: 1, y: 0, transition: springs.gentle }}
              exit={{ opacity: 0, transition: exitTransition }}
              style={{ position: 'absolute', inset: 0 }}
            >
              <GenerateControls
                t={t} ipx={ipx} ipxf={ipxf} ifw={ifw} box={box} ctext={ctext} iconImg={iconImg}
                sliderRows={sliderRows} FIRST_TRACK={FIRST_TRACK} SLIDER_PITCH={SLIDER_PITCH} LABEL_DY={LABEL_DY}
                seedTop={seedTop} scopeY={scopeY} seed={seed} setSeed={setSeed} seedFontSize={seedFontSize}
                showRecipeHelp={showRecipeHelp} setShowRecipeHelp={setShowRecipeHelp}
                selectRegionActive={selectRegionActive} onClearRegion={onClearRegion} onSelectRegion={onSelectRegion}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* actions — swap with the agent block on the same curve as the stack above */}
      <AnimatePresence initial={false}>
      {!isAgent && (
        <motion.div
          key="gen-actions"
          className="pw-hitpass"
          initial={reduced ? false : { opacity: 0, y: ipx(18) }}
          animate={{ opacity: 1, y: 0, transition: springs.gentle }}
          exit={{ opacity: 0, transition: exitTransition }}
          style={{ position: 'absolute', inset: 0 }}
        >
      {ACTIONS.map((a) => (
        <motion.button key={a.id} type="button" onClick={() => onAction(a.id)}
          whileHover={generating ? undefined : { scale: 1.05 }} whileTap={generating ? undefined : { scale: 0.94 }} transition={springs.stiff}
          style={{ ...box(a.x, actionsY, 175, 80), clipPath: squircleClip(ipx(175), ipx(80), ipx(38)), background: a.fill, border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0, opacity: generating && a.id !== 'generate' ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {a.id === 'generate' && generating
            ? <LoadingDots />
            : <FitText flow maxW={165} size={40} color={C.white}>{t(a.labelKey)}</FitText>}
        </motion.button>
      ))}
        </motion.div>
      )}
      </AnimatePresence>
      </div>
      </ScaleProvider>
    </motion.div>
  );
}
