/*
 * SiteLog — the ONE bounded conversation surface (prototype .sitelog): a
 * hidden-scrollbar, smooth-scrolling column of log entries on the warm #F7F3EA
 * paper. Empty log = blankmode: the surface goes transparent/padding-less and
 * the WelcomeCard fills it.
 *
 * Presentation only: entries render via the injected renderEntry (entry
 * components own their own animation), the scroll element + near-bottom guard
 * belong to the caller (logRef/onScroll from useSiteLogTurn).
 *
 * Geometry = prototype css px × 2 (design px, spec §UI.0) through usePx().
 */
import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { usePx } from '../design/scale';
import { useAgentFrame } from './frame';
import { useScrollFade } from '../primitives/scroll-fade';
import { WelcomeCard } from './WelcomeCard';
import type { LogEntry } from '../../agent/session';

/**
 * The scroller div, isolated from SiteLog's own render: `useScrollFade`'s settle loop writes React
 * state on every scroll/resize, and before this split that state lived in SiteLog itself, so each
 * settle frame re-ran `entries.map(renderEntry)` for a transcript that can hold hundreds of
 * unmemoized, Framer-animated cards. Local to this file rather than a shared primitive — the split
 * exists for one caller's render-cost problem, not a reusable shape. `children` is the isolation:
 * SiteLog builds it once per its OWN render, and a fade-driven re-render of this component alone
 * reuses that same element reference, so React bails out of the subtree without touching it.
 */
function FadingLogScroll({ logRef, onScroll, style, children }: {
  logRef: RefObject<HTMLDivElement>;
  onScroll(): void;
  style: CSSProperties;
  children: ReactNode;
}) {
  // Its own listener (see scroll-fade's file header), so the near-bottom autoscroll guard's own
  // `onScroll` above is untouched by this.
  const logFade = useScrollFade(logRef, 'y');
  return (
    <div
      ref={logRef}
      onScroll={onScroll}
      className="pw-noscroll"
      data-testid="sitelog"
      style={{ ...style, ...logFade }}
    >
      {children}
    </div>
  );
}

export interface SiteLogProps {
  top: number;
  height: number;
  entries: LogEntry[];
  hasKey: boolean;
  onStarter(text: string): void;
  renderEntry(e: LogEntry, i: number): ReactNode;
  logRef: RefObject<HTMLDivElement>;
  onScroll(): void;
  /** Smooth the top/height change (dock enter/leave only). MUST stay false
   *  during a UI-zoom animation, or the log lags the rest of the panel. */
  smoothGeom?: boolean;
}

export function SiteLog({ top, height, entries, hasKey, onStarter, renderEntry, logRef, onScroll, smoothGeom }: SiteLogProps) {
  const reduced = useReducedMotionConfig();
  const { px } = usePx();
  const frame = useAgentFrame();
  // Blankmode waits for the start-fresh EXIT SWEEP: switching the surface the
  // instant entries empty made the space jump while cards were still leaving.
  const empty = entries.length === 0;
  const [blank, setBlank] = useState(empty);
  useEffect(() => {
    if (!empty) setBlank(false);
    else if (reduced) setBlank(true);
  }, [empty, reduced]);
  return (
    <FadingLogScroll
      logRef={logRef}
      onScroll={onScroll}
      style={{
        position: 'absolute',
        left: px(frame.x),
        top: px(top),
        width: px(frame.w),
        height: px(height),
        boxSizing: 'border-box',
        overflowY: blank ? 'hidden' : 'auto',
        overflowX: 'hidden',
        background: blank ? 'transparent' : frame.paper,
        borderRadius: px(36),
        padding: blank ? 0 : px(24),
        display: 'flex',
        flexDirection: 'column',
        gap: px(20),
        scrollBehavior: reduced ? 'auto' : 'smooth',
        // Smooth the top/height ONLY when the dock enters/leaves (smoothGeom):
        // px-derived geometry also changes every frame while the UI zoom
        // animates, and transitioning it then makes the log lag the panel.
        // Background always eases (blank <-> paper) — a color, not a position.
        transition: !reduced && smoothGeom
          ? 'top 0.28s cubic-bezier(.4,0,.2,1), height 0.28s cubic-bezier(.4,0,.2,1), background 0.3s'
          : 'background 0.3s',
        pointerEvents: 'auto',
      }}
    >
      {blank && <WelcomeCard hasKey={hasKey} onStarter={onStarter} />}
      {/* keyed motion children (from renderEntry) animate OUT on start-fresh;
          only when the last one has left does blankmode take the surface */}
      <AnimatePresence initial={false} onExitComplete={() => { if (empty) setBlank(true); }}>
        {entries.map((e, i) => renderEntry(e, i))}
      </AnimatePresence>
    </FadingLogScroll>
  );
}
