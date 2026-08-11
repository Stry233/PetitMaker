/*
 * Assistant.tsx — the assistant's panel, and the badge that says what it is allowed to touch.
 *
 * The design draws the assistant not connected: a character, a name under it, and a speech bubble
 * holding an introduction, a key field and a button. A CONNECTED session needs a column instead: a
 * header, a live tile, a log of paper cards and an order pad. The design has no drawing for one, so
 * the plate is BUILT from the bubble's own body rect, corner radius and fill (all a filled shape
 * carries here, per tokens.ts) and the two states are that plate at two heights.
 *
 * THE HANDLE IS NOT HERE. The character is a BLOCK now (`Shell`), on its own row under the five
 * modes and built like them: the same slot, the same splat when it is active, the same caption, and
 * it owns the press. What is left here is the bubble it opens, still at the character's shoulder
 * with its tail on it — `assistant-frame.ts` measures both off the block's box.
 *
 * The plate and the NOT-CONNECTED face live here, in the main bundle: an introduction, a key field
 * and a button are three cheap boxes. A SESSION is `AssistantBody`, loaded lazily, because that is
 * what reaches the site log, the turn runner and the LLM SDKs — so the weight arrives when there is
 * a key to use it with, or when the visitor asks for setup, and never for the majority who do not
 * use the assistant at all.
 */
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAgentStore } from '../../../agent/store';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { useFontsReady } from '../../hooks/useFontsReady';
import { useScrollFade } from '../../primitives/scroll-fade';
import { usePx } from '../../design/scale';
import { exitTransition, springs, z } from '../../design/styles';
import { ASSISTANT_INK } from '../frame';
import { ACTIVE, INK, PLATE } from '../../design/tokens';
import { TEXT } from '../units';
import { useViewportHeight } from '../use-viewport';
import { BarText } from '../bars/bar-atoms';
import { INTRO, PLATE_BOX, PLATE_WIDE_W, TAIL, WIDE_GUTTER, footReserve } from './assistant-frame';
import { IntroFace } from './IntroCard';

/** The tail's own bounding box, so its clip-path has a box to be cut out of. */
const tailBox = (() => {
  const xs = TAIL.map(([x]) => x); const ys = TAIL.map(([, y]) => y);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
})();

const AssistantBody = lazy(() => import('./AssistantBody').then((m) => ({ default: m.AssistantBody })));

/**
 * The room between the plate's top and the bars, in design px. The bottom bars hang off the
 * window's own bottom edge, so a foot at a design y would run into them.
 *
 * The plate's own `maxHeight` is the binding cap, in css: this is the same measurement made in
 * javascript for the column's height, which a css length cannot decide.
 */
function panelRoom(vh: number, scale: number, foot: number): number {
  return vh / scale - PLATE_BOX.y - foot;
}

/** The painted region, shown at the assistant's shoulder: while one stands, it is a hard boundary
 *  for every edit the assistant makes, and it has to be readable with the panel shut. */
function RegionBadge() {
  const t = useT();
  const cells = useEditorStore((s) => s.region.length);
  if (cells === 0) return null;
  return (
    <div
      data-testid="shell-assistant-region-badge"
      role="status"
      style={{
        position: 'fixed',
        left: ASSISTANT_INK.right - 6,
        top: ASSISTANT_INK.top - 6,
        height: 22,
        padding: '0 9px',
        borderRadius: 999,
        background: ACTIVE,
        display: 'flex',
        alignItems: 'center',
        zIndex: z.panel + 1,
        pointerEvents: 'none',
      }}
    >
      <BarText size={TEXT.small} color={INK} weight={900}>
        {t(cells === 1 ? 'agent2.n_cells_one' : 'agent2.n_cells', { n: cells })}
      </BarText>
    </div>
  );
}

export function Assistant() {
  const { px, scale } = usePx();
  const vh = useViewportHeight();
  const foot = footReserve(useEditorStore((s) => s.editMode.mode));
  const room = panelRoom(vh, scale, foot);
  const columnH = Math.max(PLATE_BOX.drawnH, room);
  const locale = useEditorStore((s) => s.locale);

  const keysHydrated = useAgentStore((s) => s.keysHydrated);
  const provider = useAgentStore((s) => s.settings.provider);
  const hasKey = Boolean(useAgentStore((s) => s.settings.keys[provider]));
  const setupOpen = useAgentStore((s) => s.setupOpen);

  const open = useEditorStore((s) => s.assistantOpen);
  const [wantsSetup, setWantsSetup] = useState(false);
  // Closing the full setup screen without a key is a request to go back, and the design's own card
  // is what is behind it.
  useEffect(() => { if (setupOpen === false) setWantsSetup(false); }, [setupOpen]);

  const intro = !hasKey && !wantsSetup;
  // Before the vault settles, "is there a key" has no answer yet, so the plate stays at the size
  // the design draws and holds its content back rather than showing a column that may not be one.
  const ready = keysHydrated;
  const height = ready && !intro ? columnH : PLATE_BOX.drawnH;

  /*
   * The not-connected card at the drawn width, or at the wider one, decided by MEASUREMENT rather
   * than by a rule about languages: what overflows is a line count, and how many lines a sentence
   * takes at a width is something only the browser that laid it out knows.
   *
   * Reset first, measure second. A window that has just grown may have room for the drawn card
   * again, and asking "does the narrow one fit" is only possible from the narrow one — so anything
   * that can change the answer (the room, the language, which face is showing, the web font
   * landing) puts the card back to the drawn width and lets the measurement widen it again.
   */
  const plateRef = useRef<HTMLDivElement>(null);
  // The intro face is a real y-scroller on a short window (see the `overflow`/`maxHeight` comment
  // below): it "scrolls there rather than disappearing behind" the bottom bar, so a hard-clipped top
  // or bottom reads as a drawing error the same way any other scroller's would.
  const introFade = useScrollFade(plateRef, 'y');
  const [wide, setWide] = useState(false);
  useEffect(() => { setWide(false); }, [room, locale, intro]);
  useFontsReady(() => setWide(false));
  useLayoutEffect(() => {
    const el = plateRef.current;
    if (!el || wide || !intro) return;
    if (el.scrollHeight > el.clientHeight + 1) setWide(true);
  });
  const plateW = wide ? PLATE_WIDE_W : PLATE_BOX.w;

  return (
    <>
      <RegionBadge />

      <AnimatePresence>
      {open && (
        <motion.div
          key="assistant-plate"
          // Out of the block that opened it, and back into it. One group for the tail and the
          // plate, so the bubble is one thing arriving rather than two.
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85, transition: exitTransition }}
          transition={springs.stiff}
          style={{ transformOrigin: `${ASSISTANT_INK.right}px ${ASSISTANT_INK.top + ASSISTANT_INK.h / 2}px` }}
        >
          <div
            aria-hidden
            style={{
              position: 'fixed',
              left: px(tailBox.x),
              top: px(tailBox.y),
              width: px(tailBox.w),
              height: px(tailBox.h),
              background: PLATE,
              clipPath: `polygon(${TAIL.map(([tx, ty]) => `${px(tx - tailBox.x)}px ${px(ty - tailBox.y)}px`).join(',')})`,
              zIndex: z.panel,
              pointerEvents: 'none',
            }}
          />
          <div
            ref={plateRef}
            data-testid="shell-assistant-panel"
            style={{
              position: 'fixed',
              left: px(PLATE_BOX.x),
              top: px(PLATE_BOX.y),
              width: px(plateW),
              // The wide card is a card, not a half-screen panel: on a window too narrow to hold it
              // beside the map it stops at what is there rather than reaching under the rail.
              maxWidth: `calc(100vw / var(--shell-zoom, 1) - ${px(PLATE_BOX.x)}px - ${px(WIDE_GUTTER)}px)`,
              // The not-connected face is a column of drawn boxes, so its plate takes the height
              // they come to: the design's Chinese lands at the 372 it is drawn at, and a language
              // that needs another line gets a taller plate rather than a clipped sentence.
              height: intro ? undefined : px(height),
              // Both faces stop at the same floor: the top of whichever bottom bar the current
              // mode is showing (`footReserve`). The not-connected face only meets it on a window
              // short enough that its longest translation cannot fit above that bar at all, and
              // scrolls there rather than disappearing behind it — the block is the way to put
              // the whole panel away instead.
              maxHeight: `calc(100vh / var(--shell-zoom, 1) - ${px(PLATE_BOX.y)}px - ${px(foot)}px)`,
              // Both axes named: a box with one axis `visible` and the other not has the
              // visible one computed to `auto` too, and the overflowing card then paints its white
              // plates past the bubble's rounded foot instead of scrolling inside it.
              overflow: intro ? 'hidden auto' : 'hidden',
              padding: intro ? `${px(INTRO.padTop)}px 0 ${px(INTRO.padBottom)}px` : 0,
              boxSizing: 'border-box',
              borderRadius: px(PLATE_BOX.radius),
              background: PLATE,
              zIndex: z.panel,
              pointerEvents: 'auto',
              ...introFade,
            }}
          >
            {ready && (intro
              ? <IntroFace onOpenSetup={() => setWantsSetup(true)} />
              : (
                <Suspense fallback={null}>
                  <AssistantBody plateHeight={height} />
                </Suspense>
              ))}
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </>
  );
}
