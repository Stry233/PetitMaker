/*
 * WhatsThisLayer.tsx — the "what's this?" pick mode: a question cursor over the whole app, a ring
 * and a name tag over whatever marked part the pointer rests on, and the next click opens that
 * part's help page instead of acting on it.
 *
 * The layer is a full-window surface that TAKES the pointer (a pick mode is a mode; letting the
 * press through would run the control it was asking about), and reads what stands under the
 * pointer with `elementsFromPoint`, walking up to the nearest `[data-help]`. A click on the bare
 * map answers with the page for what the hand currently holds (`pageForEditState`). Escape puts
 * the mode away and reopens nothing.
 *
 * The layer stands OUTSIDE any chrome-zoomed root (no `zoom`), since the ring and tag are placed
 * from live `getBoundingClientRect()` values already in real screen px — so its text takes
 * `weightVars` at zoom 1 rather than the chrome scale, and every text-bearing element still names
 * `font.family` itself (a `<button>` does not inherit font-family from an ancestor by default).
 *
 * Motion: the banner and the whole layer enter/exit together (one fade), the ring/tag fade in when
 * a target is first found and glide (Framer `layout`) between targets rather than jumping, and both
 * clear on exit via `pointerEvents: 'none'` so a fading-out layer can't steal the click meant for
 * whatever it was covering.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { useEditorStore } from '../../../../state/store';
import { useT } from '../../../../i18n/context';
import { ensureHelpStrings } from '../../../../i18n/locales/help';
import { pushCursorSurface } from '../../../../canvas/interaction/cursor-controller';
import { roleFont, weightVars } from '../../../design/text-weight';
import { INK, PLATE } from '../../../design/tokens';
import { buttonMotion, cursors, exitTransition, font, springs, z } from '../../../design/styles';
import { useDenseScript, useDevicePixelRatio } from '../../../design/scale';
import { HELP_PAGES } from './catalog';
import type { HelpPageId } from './page-schema';
import { HELP_ATTR, openHelp, pageForEditState } from './targets';

// The chunk's words arrive with the chunk: registering at module scope means no surface in
// this file can render before its strings exist.
ensureHelpStrings();

interface Hover {
  rect: DOMRect;
  page: HelpPageId;
}

function targetAt(x: number, y: number, layer: HTMLElement): { page: HelpPageId; el: Element } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === layer || layer.contains(el)) continue;
    const marked = (el as HTMLElement).closest?.(`[${HELP_ATTR}]`);
    if (marked) {
      const page = marked.getAttribute(HELP_ATTR) as HelpPageId;
      if (HELP_PAGES[page]) return { page, el: marked };
    }
  }
  return null;
}

export function WhatsThisLayer() {
  const t = useT();
  const on = useEditorStore((s) => s.whatsThis);
  const setWhatsThis = useEditorStore((s) => s.setWhatsThis);
  const [hover, setHover] = useState<Hover | null>(null);
  /** The pointer is working the top edge, where the banner hangs: the banner steps aside so the
   *  mode blocks and the window buttons can be asked about without reading through it. */
  const [nearBanner, setNearBanner] = useState(false);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotionConfig();
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();

  useEffect(() => {
    if (!on) { setHover(null); return undefined; }
    // Found by data-attribute rather than a JSX ref: this div is an AnimatePresence direct child,
    // and framer-motion reads `children.props.ref` off every one of those, which React 18 warns on.
    const layer = document.querySelector<HTMLDivElement>('[data-testid="whats-this-layer"]');
    layerRef.current = layer;
    const restore = layer ? pushCursorSurface(layer, 'help') : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setWhatsThis(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      restore?.();
      window.removeEventListener('keydown', onKey, true);
    };
  }, [on, setWhatsThis]);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const layer = layerRef.current;
    if (!layer) return;
    setNearBanner(e.clientY < 84);
    const hit = targetAt(e.clientX, e.clientY, layer);
    if (!hit) { setHover(null); return; }
    setHover({ rect: hit.el.getBoundingClientRect(), page: hit.page });
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const layer = layerRef.current;
    if (!layer) return;
    const hit = targetAt(e.clientX, e.clientY, layer);
    if (hit) { openHelp(hit.page); return; }
    const edit = useEditorStore.getState().editMode;
    openHelp(pageForEditState({ mode: edit.mode, tool: edit.tool }));
  };

  return (
    <AnimatePresence>
      {on && (
        <motion.div
          key="whats-this-layer"
          data-testid="whats-this-layer"
          onPointerMove={onMove}
          onClick={onClick}
          onContextMenu={(e) => { e.preventDefault(); setWhatsThis(false); }}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none', transition: exitTransition }}
          transition={springs.stiff}
          style={{ position: 'fixed', inset: 0, zIndex: z.tour, cursor: cursors.help, ...weightVars(1, dpr, dense) }}
        >
          <AnimatePresence>
            {hover && (
              <motion.div
                key="hint"
                aria-hidden
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: exitTransition }}
                transition={springs.stiff}
                style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
              >
                {/* The box glides between targets as NUMBERS (left/top/width/height through the
                    spring), never as a FLIP: a FLIP moves by scaling, and scaling a bordered box
                    between two shapes warps the border and its halo mid-flight. */}
                <motion.div
                  initial={false}
                  animate={{
                    left: hover.rect.left - 7,
                    top: hover.rect.top - 7,
                    width: hover.rect.width + 14,
                    height: hover.rect.height + 14,
                  }}
                  transition={springs.stiff}
                  style={{
                    position: 'fixed',
                    border: '3px solid #B3541E',
                    borderRadius: 14,
                    boxShadow: '0 0 0 6px rgba(179,84,30,0.18)',
                  }}
                />
                <motion.div
                  initial={false}
                  // Centered over the target and clamped into the window, riding the same spring
                  // as the box; the -50% is static, so the spring only ever moves the anchor.
                  animate={{
                    left: Math.min(Math.max(hover.rect.left + hover.rect.width / 2, 120), window.innerWidth - 120),
                    top: Math.max(6, hover.rect.top - 34),
                  }}
                  transition={springs.stiff}
                  style={{
                    position: 'fixed',
                    x: '-50%',
                    maxWidth: '40vw',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    background: PLATE,
                    border: '1px solid rgba(87,73,53,0.62)',
                    borderRadius: 99,
                    padding: '5px 12px',
                    ...roleFont('small'),
                    fontFamily: font.family,
                    color: INK,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t(HELP_PAGES[hover.page].titleKey)}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          <motion.div
            initial={reduced ? false : { opacity: 0, y: -16, x: '-50%' }}
            // Stepping aside while the pointer works the top edge: the banner is the one thing on
            // this layer that could cover a control someone is trying to ask about.
            animate={{ opacity: nearBanner ? 0 : 1, y: nearBanner ? -24 : 0, x: '-50%' }}
            exit={{ opacity: 0, y: -16, x: '-50%', transition: exitTransition }}
            transition={springs.bouncy}
            style={{
              position: 'fixed',
              top: 16,
              pointerEvents: nearBanner ? 'none' : undefined,
              left: '50%',
              background: INK,
              color: '#FFFEE3',
              borderRadius: 99,
              padding: '10px 20px',
              ...roleFont('label'),
              fontFamily: font.family,
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              whiteSpace: 'nowrap',
              boxShadow: '0 6px 18px rgba(67,65,62,0.32)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFEE3" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8.6 9a3.6 3.6 0 1 1 5.2 3.2c-1.2.6-1.8 1.3-1.8 2.6" />
              <circle cx="12" cy="18.6" r="1.1" fill="#FFFEE3" stroke="none" />
            </svg>
            {t('help.whats_this_banner')}
            <motion.button
              type="button"
              {...buttonMotion}
              onClick={(e) => { e.stopPropagation(); setWhatsThis(false); }}
              style={{ background: 'rgba(255,255,255,0.16)', border: 'none', borderRadius: 99, padding: '4px 12px', ...roleFont('small'), fontFamily: font.family, color: '#FFFEE3', cursor: cursors.clickable }}
            >
              {t('help.whats_this_exit')}
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
