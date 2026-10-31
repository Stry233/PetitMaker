/**
 * A mode's panel on an upright window: it stands on the bottom bar, and the bar's own band grows up
 * behind it as one surface in the panel's plate (`controls/ModeRow.tsx`), so the panel draws no band
 * of its own. Words a bar writes "on the map" take the plate's ink inside one (`bar-atoms.tsx:BarText`).
 * Every surface standing in the bar's place takes its claim, root and band from `useBarSurface`.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useIsPresent, useReducedMotionConfig, type MotionProps } from 'framer-motion';
import { useTransition } from '../../design/motion/use-motion';
import { z } from '../../design/styles';
import { ON_DARK, PLATE_INK } from '../../design/tokens';
import { useObservedSize } from '../../primitives/use-observed-size';
import { useScrollFade } from '../../primitives/scroll-fade';
import { useFrameLayout, type BarPanel } from '../frame-layout';
import { LANDSCAPE_BAR, type FrameLayout } from '../frame-plan';
import { ShelfBand, clipToBand } from './ShelfBand';
import { EDGE, UPRIGHT_SPACE } from '../units';
import { useMorph, useMorphGroup } from '../../primitives/morph';

const PanelToneContext = createContext<BarPanel['tone'] | null>(null);

/** The plate a bar's words stand on inside an upright panel, or null on the map. */
export function PanelTone({ tone, children }: { tone: BarPanel['tone'] | null; children: ReactNode }) {
  return <PanelToneContext.Provider value={tone}>{children}</PanelToneContext.Provider>;
}

/** The ink for words on `tone`'s plate. */
export function panelInk(tone: BarPanel['tone']): string {
  return tone === 'cream' ? PLATE_INK : ON_DARK;
}

/** The plate a bar's parts stand on here, or null on the map itself. */
export function usePanelTone(): BarPanel['tone'] | null {
  return useContext(PanelToneContext);
}

/** The ink words written on the map take here: the panel plate's, or null on the map itself. */
export function usePanelInk(): string | null {
  const tone = usePanelTone();
  return tone ? panelInk(tone) : null;
}

/** The padding under an upright panel's lowest mark, in frame px: the bar's own air over the tiles
 *  makes up the rest of `UPRIGHT_SPACE.tiles`. */
export const UPRIGHT_FOOT = UPRIGHT_SPACE.tiles - UPRIGHT_SPACE.band;

/**
 * What a panel needs, in frame px: all of its content with its padding, so a docked assistant yields
 * what the panel holds rather than the panel scrolling. Read from the content's own boxes (`offset*`,
 * the frame's own px, past any scroll), so neither the room's cap on the panel nor an overhang a row
 * bleeds past the padding changes it.
 */
function measureLeast(root: HTMLElement): number {
  const bottom = contentOf(root).map((child) => child.offsetTop + child.offsetHeight);
  return Math.max(0, ...bottom) + (parseFloat(getComputedStyle(root).paddingBottom) || 0);
}

/** The boxes a panel's content stands in: its children, and theirs through a `display: contents`
 *  wrapper, which has no box of its own (its offsets read 0 and a size observer never reports it). */
function contentOf(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children as HTMLCollectionOf<HTMLElement>).flatMap((child) =>
    getComputedStyle(child).display === 'contents' ? contentOf(child) : [child]);
}

/** A panel that grows in place (a tool armed, a row of settings arriving, a handle let go) stands at
 *  its new height at once, ahead of the band, which glides up once the frame has planned it: it is
 *  clipped to the band from this frame (`ShelfBand.tsx:clipToBand`), as every size change of the band
 *  clips it. Reduced motion steps. */
function useGrowClip(): (root: HTMLElement, by: number) => void {
  const reduced = useReducedMotionConfig() === true;
  return (root, by) => { if (!reduced && by > 0.5) clipToBand(root); };
}

/**
 * Whether the shell takes its upright arrangement, and while it does, claims the bar's surface for
 * the panel `ref` measures: its height in frame px (`offsetHeight`, which the frame's zoom leaves in
 * the frame's own px), and its least depth, which the plan keeps room for: `least` where the panel
 * states it exactly, else all of it (`measureLeast`). A panel on its way out lets go at once, so the
 * surface glides to what replaces it while it fades; `shown` false lets go while another screen stands
 * in the panel's place. `least` comes back as claimed.
 */
function useBarPanel(ref: RefObject<HTMLElement | null>, tone: BarPanel['tone'], shown = true, least?: number, following = false): { upright: boolean; least: number } {
  const layout = useFrameLayout();
  const upright = layout?.shape === 'portrait';
  const claim = layout?.claimBarPanel;
  const present = useIsPresent();
  const owner = useRef(Symbol('bar panel')).current;
  // The height claimed and whether it follows a held handle change together, in one claim.
  const [shape, setShape] = useState({ height: 0, following: false });
  const [measured, setMeasured] = useState(0);
  const shownHeight = useRef(0);
  const followingRef = useRef(following);
  followingRef.current = following;
  const grow = useGrowClip();
  // The content grows on where the room caps the panel, so it is watched as well as the panel. While a
  // held handle drives the panel's height past React, its sizes are not claimed: the frame is planned
  // once as the hold begins and once as it ends.
  useObservedSize(
    () => (upright && shown && ref.current ? [ref.current, ...contentOf(ref.current)] : null),
    () => {
      const root = ref.current;
      if (!root || followingRef.current) return;
      if (shownHeight.current > 0) grow(root, root.offsetHeight - shownHeight.current);
      shownHeight.current = root.offsetHeight;
      setShape({ height: root.offsetHeight, following: false });
      setMeasured(measureLeast(root));
    },
    [upright, shown],
  );
  // A hold keeps the height claimed as it began, and its end claims the height it left.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!upright || !shown || !root) return;
    if (following) { setShape((was) => (was.following ? was : { ...was, following: true })); return; }
    shownHeight.current = root.offsetHeight;
    setShape((was) => (!was.following && was.height === root.offsetHeight ? was : { height: root.offsetHeight, following: false }));
    setMeasured(measureLeast(root));
  }, [following, upright, shown, ref]);
  const held = upright && present && shown;
  const claimed = least ?? measured;
  useEffect(() => {
    if (!claim) return;
    claim(owner, held ? { tone, height: shape.height, least: claimed, following: shape.following } : null);
  }, [claim, owner, held, tone, shape, claimed]);
  useEffect(() => () => claim?.(owner, null), [claim, owner]);
  return { upright, least: claimed };
}

/**
 * What an upright panel's root wears so its contents rise with the bar's band rather than standing
 * over the map ahead of it: a clip from its foot up, on the band's own `shell.bar.expand`, let go once
 * open so nothing it overhangs stays clipped. Nothing in the landscape shape or under reduced motion.
 */
function useBarPanelReveal(upright: boolean): MotionProps {
  const reduced = useReducedMotionConfig();
  const expand = useTransition('shell.bar.expand');
  // The band starts up only once a panel has been measured and claims it; the clip waits for that.
  const raised = (useFrameLayout()?.barPanel?.height ?? 0) > 0;
  if (!upright || reduced) return {};
  return {
    initial: { clipPath: 'inset(100% 0% 0% 0%)' },
    animate: raised ? { clipPath: 'inset(0% 0% 0% 0%)', transitionEnd: { clipPath: 'none' } } : { clipPath: 'inset(100% 0% 0% 0%)' },
    transition: expand,
  };
}

/** Whether a panel needing `least` frame px stands taller than the bar's room. */
const overRoom = (least: number, bar: FrameLayout['bar']) => bar.room !== undefined && least > bar.room + 0.5;

/**
 * An upright panel's root: window wide, standing on the bar and solid to the pointer. It grows no
 * higher than `bar.room`; a panel that needs more (`least`, where even the yielded dock leaves too
 * little room) scrolls down past it, unless `scroll` is false for a panel that caps a part of its own
 * instead. One that fits clips what its rows bleed past its padding, so it has no scroll range at all.
 */
function barPanelRoot(bar: FrameLayout['bar'], { padding, scroll = true, least = 0 }: { padding?: string; scroll?: boolean; least?: number } = {}): CSSProperties {
  const scrolls = scroll && overRoom(least, bar);
  return {
    position: 'fixed', left: 0, right: 0, bottom: bar.bottom, zIndex: z.panel, boxSizing: 'border-box', pointerEvents: 'auto',
    ...(padding === undefined ? {} : { padding }),
    // Down only: sideways the panel is the window's width, and what overhangs it clips without a scroll.
    ...(scroll ? { maxHeight: bar.room, overflowY: scrolls ? 'auto' as const : 'hidden' as const, overflowX: 'hidden' as const } : {}),
  };
}

/** A wide window's root for a surface in the bar's place: a band across the window's foot standing on
 *  the bar, open to the map around what it draws. */
export function wideBarRoot(bar: FrameLayout['bar']): CSSProperties {
  return { position: 'fixed', left: 0, right: 0, bottom: bar.bottom, zIndex: z.panel, pointerEvents: 'none' };
}

/** What a surface standing in the bar's place draws from (`useBarSurface`). */
export interface BarSurface {
  /** Whether the shell takes its upright arrangement, where the surface is the panel on the bar. */
  upright: boolean;
  bar: FrameLayout['bar'];
  /** Spread on the surface's root: the element the claim measures, the panel's mark upright
   *  (`data-bar-panel`, which tests and captures key on) and its root style, upright or wide. */
  root: { ref: RefObject<HTMLDivElement>; 'data-bar-panel'?: BarPanel['tone']; className?: string; style: CSSProperties };
  /** Spread on a wide surface's content, the piece of the chrome's morph its words and controls
   *  travel in (`primitives/morph.ts`), as wide as the window less its margins: `start` for content
   *  that keeps to its leading edge, `centre` for centred content, and `tabs` for a row of names
   *  standing apart from the rest, whose indent past the character is its own. Empty upright, where
   *  the root is the piece. */
  content: { start: Record<string, string>; centre: Record<string, string>; tabs: Record<string, string> };
  /** The upright rise, for the root or the part of the content that rises with the band. */
  reveal: MotionProps;
  /** The upright padding: the spacing scale's top and foot inside the window's side margins. The
   *  root wears it unless the surface pads a box of its own (`padRoot` false). */
  padding: string;
  /** The plate the surface's words stand on, for `PanelTone`: its tone upright, null on the map. */
  tone: BarPanel['tone'] | null;
  /** The shelves' band in the surface's tone behind a wide surface, null upright. */
  band: ReactNode;
}

/**
 * The one way a surface stands in the bar's place: upright it claims the bar (`useBarPanel`, with
 * `shown` and `least` as there) and wears `barPanelRoot` with its padding and `scroll`, scrolling with
 * the lists' edge fade and no scrollbar only where it stands taller than the room; wide it stands on
 * the bar in `wideBarRoot` with the shelves' band in `tone` behind it. The upright padding keeps the
 * plan's side margins (`portraitEdges`), `top` over the first row and `foot` under the lowest mark.
 * `overColumn` lets a surface whose least passes `bar.room` stand over the column up to `bar.reach`
 * rather than scroll; `bar` comes back as planned.
 */
export function useBarSurface(tone: BarPanel['tone'], { shown = true, least, top = UPRIGHT_SPACE.pad, foot = UPRIGHT_FOOT, padRoot = true, scroll, following, overColumn = false }: {
  shown?: boolean; least?: number; top?: number; foot?: number; padRoot?: boolean; scroll?: boolean;
  /** Its height follows a held handle (`BarPanel.following`). */
  following?: boolean;
  overColumn?: boolean;
} = {}): BarSurface {
  const ref = useRef<HTMLDivElement>(null);
  const { upright, least: claimed } = useBarPanel(ref, tone, shown, least, following);
  const reveal = useBarPanelReveal(upright);
  const layout = useFrameLayout();
  const bar = layout?.bar ?? LANDSCAPE_BAR;
  const capped = overColumn && bar.reach !== undefined ? { ...bar, room: Math.max(bar.room ?? 0, bar.reach) } : bar;
  const padding = `${top}px ${layout?.edgeRight ?? EDGE}px ${foot}px ${layout?.edgeLeft ?? EDGE}px`;
  const rootPadding = padRoot ? padding : undefined;
  // Only an upright panel taller than the room scrolls, and only it wears the edge fade.
  const fade = useScrollFade(ref, 'y', { on: upright && scroll !== false && overRoom(claimed, capped) });
  // Upright the panel is one piece, a card as wide as the frame whose content re-flows; wide, the band
  // and the content are pieces of their own, since the window decides their width and the band
  // stretches where the content must not.
  const morph = useMorph('bar', 'card');
  const group = useMorphGroup();
  const start = useMorph('bar-content', 'span-start');
  const centre = useMorph('bar-content', 'span-centre');
  const tabs = useMorph('shelf-tabs', 'span-start');
  return {
    upright, bar, reveal, padding,
    root: upright
      ? scroll === false
        ? { ref, ...morph, 'data-bar-panel': tone, style: barPanelRoot(capped, { padding: rootPadding, scroll }) }
        : { ref, ...morph, 'data-bar-panel': tone, className: 'pw-noscroll', style: { ...barPanelRoot(capped, { padding: rootPadding, scroll, least: claimed }), ...fade } }
      : { ref, ...group, style: wideBarRoot(bar) },
    content: upright ? { start: {}, centre: {}, tabs: {} } : { start, centre, tabs },
    tone: upright ? tone : null,
    band: upright ? null : <ShelfBand tone={tone} morph="bar-band" />,
  };
}
