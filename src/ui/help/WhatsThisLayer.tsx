import { framerMotion } from '../design/motion';
import { ActionButton } from '../primitives/ActionButton';
import { clientPoint, toClientPoint, viewportSize } from '../../platform/device/viewport-space';
/** The full-window picker consumes control clicks and resolves the foreground help target.
 * Hit testing uses physical pixels; outlines use logical editor coordinates for zoom and rotation.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { useEditorStore } from '../../state/store';
import { buildToolOf } from '../../state/editing/edit-mode';
import { useHelpTables, useT } from '../../i18n/context';
import { pushCursorSurface } from '../../view/interaction/cursor-controller';
import { roleFont, weightVars } from '../design/text-weight';
import { INK, MAP_EDGE_ALPHA, MAP_TEXT, PLATE, FOCUS_RING, ON_DARK, rgbaOf } from '../design/tokens';
import { cursors, font, z, radii, shadows } from '../design/styles';
import { useDenseScript, useDevicePixelRatio } from '../design/scale';
import { HELP_PAGES } from './catalog';
import type { HelpPageId } from './page-schema';
import { openHelp, pageForEditState, helpTargetAt } from '../session/help-targets';
import { inheritedHelpTarget } from '../primitives/help-target';
import { useOverlayLock } from '../primitives/use-overlay-lock';
import { visualRect, type VisualRect } from '../design/visual-rect';

interface Hover {
  rect: VisualRect;
  page: HelpPageId;
  anchor?: string;
}

function targetAt(x: number, y: number, layer: HTMLElement) {
  const point = toClientPoint(x, y);
  const hit = helpTargetAt(point.x, point.y, layer);
  return hit && HELP_PAGES[hit.page as HelpPageId] ? { ...hit, page: hit.page as HelpPageId } : null;
}

export function WhatsThisLayer() {
  const t = useT();
  useHelpTables();
  const on = useEditorStore((s) => s.whatsThis);
  useOverlayLock(on);
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
    if (!on) { setHover(null); setNearBanner(false); return undefined; }
    // Found by data-attribute rather than a JSX ref: this div is an AnimatePresence direct child,
    // and framer-motion reads `children.props.ref` off every one of those, which React 18 warns on.
    const layer = document.querySelector<HTMLDivElement>('[data-testid="whats-this-layer"]');
    layerRef.current = layer;
    const restore = layer ? pushCursorSurface(layer, 'help') : null;
    const onFocus = () => {
      const element = document.activeElement;
      const target = inheritedHelpTarget(element);
      setHover(target && element && HELP_PAGES[target.page as HelpPageId] ? {
        rect: visualRect(element), page: target.page as HelpPageId, anchor: target.anchor,
      } : null);
    };
    const onWheel = (event: WheelEvent) => {
      if (!layer) return;
      event.preventDefault();
      const front = document.elementsFromPoint(event.clientX, event.clientY).find(el => el !== layer && !layer.contains(el));
      for (let el = front; el instanceof HTMLElement; el = el.parentElement ?? undefined) {
        const style = getComputedStyle(el);
        const vertical = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
        const horizontal = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
        if ((vertical && event.deltaY) || (horizontal && event.deltaX)) {
          const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1;
          if (vertical) el.scrollTop += event.deltaY * unit;
          if (horizontal) el.scrollLeft += event.deltaX * unit;
          setHover(null); break;
        }
      }
    };
    document.addEventListener('focusin', onFocus);
    layer?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      restore?.();
      document.removeEventListener('focusin', onFocus);
      layer?.removeEventListener('wheel', onWheel);
    };
  }, [on, setWhatsThis]);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const layer = layerRef.current;
    if (!layer) return;
    setNearBanner(clientPoint(e).y < 84);
    const hit = targetAt(clientPoint(e).x, clientPoint(e).y, layer);
    if (!hit) { setHover(null); return; }
    setHover({ rect: visualRect(hit.el), page: hit.page, anchor: hit.anchor });
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const layer = layerRef.current;
    if (!layer) return;
    const hit = targetAt(clientPoint(e).x, clientPoint(e).y, layer);
    if (hit) { openHelp(hit.page, hit.anchor); return; }
    const point = toClientPoint(clientPoint(e).x, clientPoint(e).y);
    const front = document.elementsFromPoint(point.x, point.y).find(el => el !== layer && !layer.contains(el));
    if (!front || !front.closest('canvas')) return;
    const s = useEditorStore.getState();
    openHelp(pageForEditState({ mode: s.editMode.mode, tool: buildToolOf(s) }));
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
          exit={{ opacity: 0, pointerEvents: 'none', transition: framerMotion('surface.leave') }}
          transition={framerMotion('surface.arrive')}
          style={{ position: 'fixed', inset: 0, zIndex: z.helpPicker, cursor: cursors.help, ...weightVars(1, dpr, dense) }}
       >
          <AnimatePresence>
            {hover && (
              <motion.div
                key="hint"
                aria-hidden
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: framerMotion('surface.leave') }}
                transition={framerMotion('surface.arrive')}
                style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
             >
                {/* The box glides between targets as numbers (left/top/width/height through the
                    spring), never as a flip: a flip moves by scaling, and scaling a bordered box
                    between two shapes warps the border and its halo mid-flight. */}
                <motion.div
                  initial={false}
                  animate={{
                    left: hover.rect.left - 7,
                    top: hover.rect.top - 7,
                    width: hover.rect.width + 14,
                    height: hover.rect.height + 14,
                  }}
                  transition={framerMotion('surface.arrive')}
                  style={{
                    position: 'fixed',
                    border: `3px solid ${FOCUS_RING}`,
                    borderRadius: radii.field,
                    boxShadow: shadows.halo,
                  }}
                />
                <motion.div
                  initial={false}
                  // Centered over the target and clamped into the window, riding the same spring
                  // as the box; the -50% is static, so the spring only ever moves the anchor.
                  animate={{
                    left: Math.min(Math.max(hover.rect.left + hover.rect.width / 2, 120), viewportSize().width - 120),
                    top: Math.max(6, hover.rect.top - 34),
                  }}
                  transition={framerMotion('surface.arrive')}
                  style={{
                    position: 'fixed',
                    x: '-50%',
                    maxWidth: '40vw',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    background: PLATE,
                    border: `1px solid ${rgbaOf(INK, MAP_EDGE_ALPHA)}`,
                    borderRadius: radii.pill,
                    padding: '4px 12px',
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
            exit={{ opacity: 0, y: -16, x: '-50%', transition: framerMotion('surface.leave') }}
            transition={framerMotion('surface.pop')}
            style={{
              position: 'fixed',
              top: 16,
              pointerEvents: nearBanner ? 'none' : undefined,
              left: '50%',
              background: INK,
              color: MAP_TEXT,
              borderRadius: radii.pill,
              padding: '10px 20px',
              ...roleFont('label'),
              fontFamily: font.family,
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              whiteSpace: 'nowrap',
              boxShadow: shadows.float,
            }}
         >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={MAP_TEXT} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8.6 9a3.6 3.6 0 1 1 5.2 3.2c-1.2.6-1.8 1.3-1.8 2.6" />
              <circle cx="12" cy="18.6" r="1.1" fill={MAP_TEXT} stroke="none" />
            </svg>
            {t('help.whats_this_banner')}
            <ActionButton
              onClick={(e) => { e.stopPropagation(); setWhatsThis(false); }}
              style={{ background: rgbaOf(ON_DARK, 0.16), border: 'none', borderRadius: radii.pill, padding: '4px 12px', ...roleFont('small'), fontFamily: font.family, color: MAP_TEXT, cursor: cursors.clickable }}
           >
              {t('help.whats_this_exit')}
            </ActionButton>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
