import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { viewportSizeSnapshot } from '../../platform/device/viewport-space';
import { liveScaleNow, onLiveScale, scaleMovingNow, useDockRef, useScaleSpan, useViewportSize } from '../design/scale';
import { useSettledUiZoom } from '../design/ui-zoom-anim';
import { useUiPreviewPose } from '../design/preview';
import { useCurrentInputMode, useLayoutShape } from '../design/input-mode';
import { cssMotion } from '../design/motion';
import type { MotionId } from '../design/motion/registry';
import { cornerArt, sessionModes, type LayerMode } from './frame';
import { planFrame, railClearanceFor, type FrameLayout, type RailPlan } from './frame-plan';
import { useEditorStore } from '../../state/store';
import { useFramePose } from '../session/use-frame-pose';
import { useEffectEvent } from '../primitives/use-effect-event';
import { useFrameZoom } from './use-frame-zoom';
import { PLATE_MIN_WIDTH, colsOf, plateDepth, plateMinDepth } from './controls/layer-plate';
import { dockAside, dockDepthMostNow, setDockCeiling, useDockDepth, useDockHeld, useDockStage } from './use-dock';
import { bottomDockCeiling, bottomDockFloor, frameRoomAt, frameRoomBeside, frameZoomAt } from './panel-frame';

/** The panel an open mode raises from the upright bar: the plate it is drawn on, its measured height
 *  above the bar and the least of it that can still work, in frame px. */
export interface BarPanel {
  tone: 'dark' | 'cream';
  height: number;
  least: number;
  /** Its height follows a held handle, so the band takes each height without a glide. */
  following?: boolean;
}

export interface LayoutState extends FrameLayout {
  layerMode: LayerMode;
  setLayerMode: (mode: LayerMode) => void;
  /** The panel standing on the upright bar, or null: the latest claim still held. */
  barPanel: BarPanel | null;
  /** Holds `panel` for `owner`, or lets go with null. A panel arriving while another leaves claims
   *  after it, so the leaving one's release never takes the surface from it. */
  claimBarPanel: (owner: symbol, panel: BarPanel | null) => void;
  /** The deepest share of the window's height the bottom dock may take under this plan
   *  (`panel-frame.ts:bottomDockCeiling`); 1 where the plan bounds nothing. */
  dockCeiling: number;
  /** The rail this plan places in a frame `width` by `height` of its own px. */
  railAt: (width: number, height: number) => RailPlan;
  /** The frame's room this frame of a scale glide, or null at rest, during a dock slide and in a picture. */
  liveRoom: () => { width: number; height: number } | null;
  /** The window's size changed since the plan last committed: what this plan moves, it moves with the
   *  window rather than gliding there (`usePlanGlide`). */
  byWindow: boolean;
}

const FrameLayoutContext = createContext<LayoutState | null>(null);

type FrameOptions = Parameters<typeof planFrame>[2];

/**
 * The frame planned with the open layer plate as deep as it draws: the square takes only the columns
 * its planned width holds (`layer-plate.ts:colsOf`), which deepens it, so a plan too narrow for its
 * columns is planned again at the deeper plate until the columns it places are the ones it planned for.
 */
function planWithPlate(width: number, height: number, opts: FrameOptions, mode: LayerMode): FrameLayout {
  const touch = opts.inputMode === 'touch';
  let cols = colsOf(mode);
  let plan = planFrame(width, height, opts);
  for (let fit = colsOf(mode, plan.plateMaxWidth, touch); fit < cols; fit = colsOf(mode, plan.plateMaxWidth, touch)) {
    cols = fit;
    plan = planFrame(width, height, { ...opts, plateDepth: plateDepth(mode, touch, cols) });
  }
  return plan;
}

export function useFrameLayout(): LayoutState | null {
  return useContext(FrameLayoutContext);
}

/** The CSS transition gliding the given properties of a surface the plan places on `id`, or none ('')
 *  in a commit the window's size re-planned, so a resize that keeps the arrangement moves it with the
 *  window (UI-28) while any other change of the plan glides. */
export function usePlanGlide(id: MotionId): (properties: readonly string[]) => string {
  const byWindow = !!useFrameLayout()?.byWindow;
  return (properties) => (byWindow ? '' : cssMotion(id, properties));
}

export function useRailClearance(bottom: number, height: number): number {
  const layout = useFrameLayout();
  return layout ? railClearanceFor(layout, bottom, height) : 0;
}

/** One plan for the mode row, character, corner actions, rail and bottom band in the remaining workspace. */
export function FrameLayoutProvider({ children }: { children: ReactNode }) {
  const pose = useUiPreviewPose();
  const [layerMode, setLayerMode] = useState<LayerMode>(pose?.layerPanel ?? 'pill');
  const [claims, setClaims] = useState<readonly (readonly [symbol, BarPanel])[]>([]);
  const claimBarPanel = useCallback((owner: symbol, panel: BarPanel | null) => setClaims((was) => {
    const at = was.findIndex(([held]) => held === owner);
    if (!panel) return at < 0 ? was : was.filter(([held]) => held !== owner);
    if (at < 0) return [...was, [owner, panel]];
    const [, kept] = was[at]!;
    if (kept.tone === panel.tone && kept.height === panel.height && kept.least === panel.least && kept.following === panel.following) return was;
    return was.map((claim, i) => (i === at ? [owner, panel] as const : claim));
  }), []);
  const barPanel = claims.length ? claims[claims.length - 1]![1] : null;
  const viewport = useViewportSize();
  // The window the committed plan stood in; a picture stands in none.
  const planned = useRef(viewport);
  const byWindow = !pose && (planned.current.w !== viewport.w || planned.current.h !== viewport.h);
  useLayoutEffect(() => { planned.current = viewport; });
  const zoom = useFrameZoom();
  const dock = useDockRef();
  const { aside, edge } = useDockStage();
  const depth = useDockDepth();
  const uiZoom = useSettledUiZoom();
  // A pictured frame stands at its posed scale whatever the live interface is doing.
  const liveGlide = useScaleSpan();
  const glide = pose ? null : liveGlide;
  const shape = useLayoutShape();
  const inputMode = useCurrentInputMode();
  const touch = inputMode === 'touch';
  const upright = shape === 'portrait';
  // The mode row and corner a planet session reduces to, so its menu stays beside the modes as
  // long as the controls that show allow.
  const planetSession = useEditorStore((s) => s.planetSession);
  const sessionPose = useFramePose();
  const modes = sessionModes(planetSession, sessionPose === 'repair').length;
  const corner = cornerArt(sessionPose !== 'map');
  let { width, height } = frameRoomBeside(viewport.w, viewport.h, zoom, dock);
  const held = useDockHeld() && edge === 'bottom' && aside >= 1;
  // Reserve the tightest end during a slide or a held seam's drag without subscribing React to its
  // individual frames: the zoom rises with the dock's strip, so the tightest room is at an end, and a
  // held seam may reach as deep as the dock's most. A scale glide plans for its settled end, the plan
  // it lands on, so nothing the plan places moves when it ends; only the rail re-plans on its frames.
  const sliding = aside > 0 && aside < 1;
  if (sliding || held) {
    width = Infinity;
    height = Infinity;
    const depths = edge !== 'bottom' ? [undefined] : held ? [depth, Math.max(depth, dockDepthMostNow())] : [depth];
    const asides = sliding ? [0, 1] : [aside];
    for (const d of depths) for (const at of asides) {
      const room = frameRoomAt(at, viewport.w, viewport.h, uiZoom, { touch, upright, depth: d });
      width = Math.min(width, room.width);
      height = Math.min(height, room.height);
    }
  }
  const panelDepth = barPanel?.height ?? 0;
  const panelLeast = barPanel?.least ?? 0;
  const rowOpen = useEditorStore((s) => s.modeRowOpen) && !pose;
  const opts = useMemo(() => ({
    open: layerMode !== 'pill', plateDepth: plateDepth(layerMode, inputMode === 'touch'), plateMinDepth: plateMinDepth(layerMode, inputMode === 'touch'), plateMinWidth: PLATE_MIN_WIDTH,
    modes, corner, shape, inputMode, panelDepth, panelLeast, rowOpen,
  }), [layerMode, modes, corner, shape, inputMode, panelDepth, panelLeast, rowOpen]);
  // Remembers its last room, so the live rail's snapshot and its writer plan once a frame between them.
  const railAt = useMemo(() => {
    let last: { w: number; h: number; rail: RailPlan } | null = null;
    return (w: number, h: number) =>
      (last && last.w === w && last.h === h ? last.rail : (last = { w, h, rail: planWithPlate(w, h, opts, layerMode).rail }).rail);
  }, [opts, layerMode]);
  // A slide keeps its tightest-end plan; a scale glide re-plans the rail on its own frames, and on until
  // the render that ends it, so the rail stands at the settled plan's place when that render lands.
  const liveRoom = useCallback(() => {
    if (pose || (!scaleMovingNow() && !glide)) return null;
    const at = dockAside.get();
    if (at > 0 && at < 1) return null;
    const { touch: t, uiZoom: z } = liveScaleNow();
    const { width: vw, height: vh } = viewportSizeSnapshot();
    const room = frameRoomAt(at, vw, vh, z, { touch: t, upright, depth: edge === 'bottom' ? depth : undefined });
    return { width: room.width, height: room.height };
  }, [pose, glide, edge, depth, upright]);
  const value = useMemo(() => {
    const plan = planWithPlate(width, height, opts, layerMode);
    // The frame bounds the bottom dock by the least height it can stand in, drawn at the zoom it has
    // with no dock, which is never smaller than the docked one; through a scale glide, at its settled
    // end, as the plan, so the dock does not move when the glide ends.
    const free = frameZoomAt(0, viewport.w, viewport.h, uiZoom, { touch, upright });
    // It yields down to its handle, so the panel on the bar never scrolls while the window has room.
    const dockCeiling = plan.leastHeight > 0 ? Math.max(bottomDockFloor(free, viewport.h), bottomDockCeiling(plan.leastHeight, free, viewport.h)) : 1;
    return { ...plan, layerMode, setLayerMode, barPanel, claimBarPanel, dockCeiling, railAt, liveRoom, byWindow };
  }, [width, height, opts, layerMode, barPanel, claimBarPanel, viewport.w, viewport.h, uiZoom, touch, upright, railAt, liveRoom, byWindow]);
  // The live plan hands its ceiling to the dock before the paint; a pictured frame bounds nothing.
  const { dockCeiling } = value;
  useLayoutEffect(() => { if (!pose) setDockCeiling(dockCeiling); }, [pose, dockCeiling]);
  // An unfolded stack lasts only as long as the fold: a plan that holds the row whole, wide or upright,
  // closes it, so no later fold opens by itself.
  const folded = !!value.modeRow.folded;
  useLayoutEffect(() => { if (rowOpen && !folded) useEditorStore.getState().setModeRowOpen(false); }, [rowOpen, folded]);
  useLayoutEffect(() => (pose ? undefined : () => setDockCeiling(1)), [pose]);
  return <FrameLayoutContext.Provider value={value}>{children}</FrameLayoutContext.Provider>;
}

/** What of a rail plan changes its shape rather than its place: a change re-renders the rail. */
function railShape(rail: RailPlan): string {
  return `${rail.kitButtons}:${rail.steppers}:${rail.kitFiles}:${rail.historyFiles}:${rail.historyInset}:${rail.kitRows ?? ''}`;
}

/** The rail at the frame's live room during a scale glide, as the frame re-plans it each frame there:
 *  the rail re-renders only when its shape changes, and `useLiveRailWriter` moves it in between. At
 *  rest, during a dock slide and in a picture it is the plan's own. */
export function useLiveRail(layout: LayoutState): RailPlan {
  const shape = useSyncExternalStore(onLiveScale, () => {
    const room = layout.liveRoom();
    return room ? railShape(layout.railAt(room.width, room.height)) : '';
  }, () => '');
  const room = shape ? layout.liveRoom() : null;
  return room ? layout.railAt(room.width, room.height) : layout.rail;
}

/** The tops the live rail writer last drew the kit and history at, null where no glide has moved them. */
export interface DrawnRail { kitTop: number | null; historyTop: number | null }

/** Writes the kit's and history's tops on each frame of a scale glide from the rail at the live room,
 *  while that rail has the shape the last render drew; a render re-applies them before the paint.
 *  `drawn` keeps what it wrote, so a refold's glide starts where the group stands. */
export function useLiveRailWriter(
  layout: LayoutState, shown: RailPlan, kit: { current: HTMLElement | null }, history: { current: HTMLElement | null }, drawn: { current: DrawnRail },
): void {
  const write = useEffectEvent(() => {
    const room = layout.liveRoom();
    if (!room) { drawn.current = { kitTop: null, historyTop: null }; return; }
    const rail = layout.railAt(room.width, room.height);
    if (railShape(rail) !== railShape(shown)) return;
    if (kit.current) kit.current.style.top = `${rail.kitTop}px`;
    if (history.current) history.current.style.top = `${rail.historyTop}px`;
    drawn.current = { kitTop: rail.kitTop, historyTop: rail.historyTop };
    // The landing's tops are resolved now, before the render that turns the groups' `top` transitions
    // back on, or the browser would play them from the glide's last frame to the landing.
    if (!scaleMovingNow()) for (const el of [kit.current, history.current]) if (el) getComputedStyle(el).top;
  });
  useEffect(() => onLiveScale(write), []);
  useLayoutEffect(() => { write(); });
}
