/**
 * The editing toolbars' one switching mechanism: controls are slots with semantic ids, so a control two
 * tools share is one node that glides to its new place while its content animates the value; only a
 * control one tool offers enters or leaves. Travel is measured in the frame's own px with
 * `offsetLeft`/`offsetTop` and played as `left`/`top` offsets rebased with `MotionValue.jump`, never
 * layout projection, so the zoom cannot cancel it.
 */
import { Component, createContext, useContext, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import {
  AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotionConfig,
  type AnimationPlaybackControls, type MotionValue, type Transition,
} from 'framer-motion';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { seconds } from '../../design/motion';
import { z } from '../../design/styles';
import { INK } from '../../design/tokens';
import { useFrameLayout, usePlanGlide, type BarPanel } from '../frame-layout';
import { useTransition } from '../../design/motion/use-motion';
import { EDGE_RIGHT, QUAD, UPRIGHT_SPACE } from '../units';
import { PanelTone, UPRIGHT_FOOT, useBarSurface } from './bar-panel';
import { CELL_BOX, PLATE_PAD, SWATCH_ROW_GAP } from './terrain-cells';
import { CAPTION_HANG, CAPTION_SWAY, PILL_RISE, ToolHighlight, TOOL_PILL_GAP } from './ToolPill';
import { ToolRow } from './ToolRow';
import { BrushSizeFills, useBrushSizeWidths } from './BrushSizeControl';
import { useScrollRow } from '../../primitives/use-scroll-row';
import { useFrameZoom } from '../use-frame-zoom';
import { scaleMovingNow, usePx } from '../../design/scale';

export interface ToolbarSlot {
  /** What the control means. Two tools offering the same control give it the same id. */
  id: string;
  node: ReactNode;
  /** Stands at the far end of its row. */
  end?: boolean;
  /** The node plays its own entrance and exit. */
  ownMotion?: boolean;
  /** Upright, a row whose controls hang a caption under them (`CAPTION_TOP`), which it keeps room for. */
  captioned?: boolean;
  /** How the slot grows and shrinks in its row, and the least it shrinks to; by default it keeps its
   *  own width. */
  flex?: string;
  minWidth?: number;
  /** The brush size slider: upright it stands at the tool row's far end rather than among the
   *  settings, filling what the pills leave and giving up its width before they do. */
  sizeSlider?: boolean;
}

export interface ToolbarSpec {
  /** Rows standing above the tool row, nearest last. */
  rows: readonly ToolbarSlot[];
  pills: readonly ToolbarSlot[];
  /** The id of the armed pill, or null. */
  activePill: string | null;
  pillAttrs?: Record<string, unknown>;
  /** The armed tool's settings, after the divider. */
  options: readonly ToolbarSlot[];
  /** Controls after the settings. */
  trailing: readonly ToolbarSlot[];
  frameAttrs?: Record<string, unknown>;
}

interface SlotHandle {
  outer: HTMLDivElement | null;
  x: MotionValue<number>;
  y: MotionValue<number>;
  running: AnimationPlaybackControls[];
  present: boolean;
  popped: boolean;
  /** Stands at the far end of its row, so it travels by its right edge. */
  end: boolean;
}

/** A slot's box in its row, in the row's own px; `y` is measured from the row's bottom edge, which
 *  is where every toolbar is anchored. */
interface Place { x: number; y: number; top: number; width: number; height: number; rowHeight: number }

const SlotRegistry = createContext<Map<string, SlotHandle> | null>(null);

function placeOf(el: HTMLElement): Place | null {
  const row = el.parentElement;
  if (!row) return null;
  return {
    x: el.offsetLeft, y: el.offsetTop - row.offsetHeight, top: el.offsetTop,
    width: el.offsetWidth, height: el.offsetHeight, rowHeight: row.offsetHeight,
  };
}

/** A departing slot leaves the flow where it stood, held to the row's bottom edge, so the
 *  remaining controls reach their final places while it fades. */
function pop(el: HTMLElement, place: Place): void {
  Object.assign(el.style, {
    position: 'absolute', margin: '0', left: `${place.x}px`, bottom: `${place.rowHeight - place.top - place.height}px`,
    width: `${place.width}px`, height: `${place.height}px`,
  });
}

function unpop(el: HTMLElement): void {
  for (const key of ['position', 'margin', 'left', 'bottom', 'width', 'height'] as const) el.style[key] = '';
}

/**
 * Snapshots every slot before React writes the DOM and plays the glides once all of them have
 * committed. A class because only `getSnapshotBeforeUpdate` sees the layout a switch replaces.
 */
class SlotFlip extends Component<{
  registry: Map<string, SlotHandle>; reduced: boolean; transition: Transition;
  /** The settled UI scale the row is drawn at. */
  scale: number;
  children: ReactNode;
}> {
  getSnapshotBeforeUpdate(): Map<string, Place> {
    const before = new Map<string, Place>();
    for (const [id, handle] of this.props.registry) {
      if (!handle.outer || handle.popped) continue;
      const place = placeOf(handle.outer);
      if (place) before.set(id, place);
    }
    return before;
  }

  componentDidUpdate(previous: Readonly<{ scale: number }>, _state: unknown, before: Map<string, Place>): void {
    const { registry, reduced, transition, scale } = this.props;
    for (const [id, handle] of registry) {
      if (handle.present || handle.popped || !handle.outer) continue;
      const place = before.get(id);
      if (place) pop(handle.outer, place);
      handle.popped = true;
    }
    // A new scale redraws the row in other px, and while the scale glides the row's own width follows
    // the live zoom between renders, so neither change of a slot's offsets is a travel of its own:
    // the scale's glide carries the row.
    if (reduced || previous.scale !== scale || scaleMovingNow()) return;
    for (const [id, handle] of registry) {
      const from = before.get(id);
      if (!handle.present || !handle.outer || !from) continue;
      const to = placeOf(handle.outer);
      if (!to) continue;
      // A control at the row's far end holds its right edge, so one whose width changed does not
      // travel by the difference.
      const dx = handle.end ? from.x + from.width - to.x - to.width : from.x - to.x, dy = from.y - to.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      handle.running.forEach(run => run.stop());
      // Rebase without turning the coordinate change into velocity.
      handle.x.jump(handle.x.get() + dx);
      handle.y.jump(handle.y.get() + dy);
      handle.running = [animate(handle.x, 0, transition), animate(handle.y, 0, transition)];
    }
  }

  render() { return this.props.children; }
}

function Slot({ slot, delay }: { slot: ToolbarSlot; delay: number }) {
  const registry = useContext(SlotRegistry)!;
  const present = useIsPresent();
  const outer = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0), y = useMotionValue(0);
  const handle = useRef<SlotHandle | null>(null);
  handle.current ??= { outer: null, x, y, running: [], present: true, popped: false, end: !!slot.end };
  const enter = useTransition('tool.control.enter');
  const leave = useTransition('tool.control.leave');

  useLayoutEffect(() => {
    const own = handle.current!;
    own.outer = outer.current;
    registry.set(slot.id, own);
    return () => {
      own.running.forEach(run => run.stop());
      if (registry.get(slot.id) === own) registry.delete(slot.id);
    };
  }, [registry, slot.id]);
  useLayoutEffect(() => {
    const own = handle.current!;
    own.present = present;
    own.end = !!slot.end;
    // A control that returns before its departure finished rejoins the flow.
    if (present && own.popped && own.outer) { unpop(own.outer); own.popped = false; }
  });

  const fade = slot.ownMotion ? {} : {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { ...enter, delay } },
    exit: { opacity: 0, transition: leave },
  };
  return <div ref={outer} data-toolbar-slot={slot.id} aria-hidden={!present || undefined} {...(!present ? { inert: '' } : {})}
    style={{ flex: slot.flex ?? 'none', minWidth: slot.minWidth, marginLeft: slot.end ? 'auto' : undefined }}>
    <motion.div {...fade} style={{ position: 'relative', left: x, top: y }}>{slot.node}</motion.div>
  </div>;
}

/** A row or column of slots. Departures and arrivals use the registry's leave and enter motions;
 *  under reduced motion the swap happens before paint. */
export function MorphRow({ slots, column = false, gap = 0, underlay, style, attrs }: {
  slots: readonly ToolbarSlot[];
  column?: boolean;
  gap?: number;
  /** Drawn behind every slot, in the row's own coordinates. */
  underlay?: ReactNode;
  style?: CSSProperties;
  attrs?: Record<string, unknown>;
}) {
  const reduced = !!useReducedMotionConfig();
  const { scale } = usePx();
  const registry = useRef(new Map<string, SlotHandle>()).current;
  const transition = useTransition('tool.control.morph') as Transition;
  const previous = useRef<readonly string[]>(slots.map(slot => slot.id));
  const leaving = previous.current.some(id => !slots.some(slot => slot.id === id));
  useLayoutEffect(() => { previous.current = slots.map(slot => slot.id); });
  // Arrivals wait for departures so two controls never stand in one place at once.
  const delay = leaving && !reduced ? seconds('tool.control.leave') : 0;
  const body = slots.map(slot => <Slot key={slot.id} slot={slot} delay={delay}/>);
  return <SlotRegistry.Provider value={registry}>
    <SlotFlip registry={registry} reduced={reduced} transition={transition} scale={scale}>
      <div {...attrs} style={{
        position: 'relative', display: 'flex', flexDirection: column ? 'column' : 'row',
        alignItems: column ? 'stretch' : 'flex-start', gap, ...style,
      }}>
        {underlay}
        {/* No slot moves by layout projection, so a slot's presence re-renders nothing around it. */}
        {reduced ? body : <AnimatePresence initial={false} presenceAffectsLayout={false}>{body}</AnimatePresence>}
      </div>
    </SlotFlip>
  </SlotRegistry.Provider>;
}

const RULE_H = 26;
const RULE: ToolbarSlot = {
  id: 'options.rule',
  node: <span aria-hidden style={{ display: 'block', width: 1, height: RULE_H, marginTop: (CELL_BOX.h - RULE_H) / 2, background: INK, opacity: .25 }}/>,
};

/** The tool pills with the armed plate under them, the armed tool's settings, then trailing
 *  controls. The editor and Help figures share it. */
export function ToolbarRow({ pills, activePill, pillAttrs, options, trailing }: Omit<ToolbarSpec, 'rows' | 'frameAttrs'>) {
  const active = pills.findIndex(pill => pill.id === activePill);
  const slots: ToolbarSlot[] = [
    { id: 'tools', node: <MorphRow slots={pills} gap={TOOL_PILL_GAP} attrs={pillAttrs} underlay={<ToolHighlight index={active}/>}/> },
    ...(options.length ? [RULE, ...options] : []),
    ...trailing,
  ];
  return <ToolRow><MorphRow slots={slots} gap={QUAD.gap} style={{ flex: '1 0 auto' }}/></ToolRow>;
}

/** Where the pills that stay end, in the run's own px: a departing pill stands out of its row's flow
 *  (`pop`) and a gliding one is offset from its place in it, so the row's box ends at the settled set. */
function settledPillsEnd(run: HTMLElement): number {
  const pills = run.firstElementChild;
  if (!(pills instanceof HTMLElement)) return run.scrollWidth;
  return pills.offsetLeft + pills.offsetWidth + parseFloat(getComputedStyle(run).paddingRight);
}

/** The upright tool row's pills, in a box of their own that scrolls sideways once the row is too
 *  narrow for them beside the size slider at its narrowest. A caption swaying past the last pill
 *  while the armed pill changes stands in its bleed, and pills leaving the row count for nothing, so
 *  neither reads as more to scroll to. Positioned, so the pills' offsets are measured from it. */
function PillRun({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const fade = useScrollRow(ref, {
    zoom: useFrameZoom(), bleed: { top: PILL_RISE, right: CAPTION_SWAY, bottom: CAPTION_HANG, left: 0 }, pointerEvents: 'auto',
    fade: { extent: settledPillsEnd },
  });
  return <div ref={ref} className="pw-noscroll" style={{ display: 'flex', position: 'relative', ...fade }}>{children}</div>;
}

/** The upright panel's rows, top down: the rows a wide bar stands above its tool row, the armed
 *  tool's settings and trailing controls in one row that scrolls sideways, then the tool row last, at
 *  the panel's foot, so a switch of tool never moves it, the size slider at its far end. Short of room,
 *  the slider narrows first, to its least, and then the pills scroll sideways; every slot keeps its id
 *  so a switch morphs. */
function uprightSlots({ rows, pills, activePill, pillAttrs, options, trailing }: ToolbarSpec, slider: { full: number; least: number }): ToolbarSlot[] {
  const active = pills.findIndex(pill => pill.id === activePill);
  // A shrink far above the pills' own, so the slider gives up its width before they give up any.
  const toolEnd = trailing.filter(slot => slot.sizeSlider).map(slot => ({
    ...slot, end: true, flex: `0 1000 ${slider.full}px`, minWidth: slider.least,
    node: <BrushSizeFills.Provider value>{slot.node}</BrushSizeFills.Provider>,
  }));
  // Each setting stands at its own width, so its caption centres under it.
  const settings = [...options, ...trailing.filter(slot => !slot.sizeSlider)].map(slot => ({ ...slot, end: false }));
  // The tool row's caption room is the panel's own padding under it, so arming a tool never moves it.
  const above = [
    ...rows,
    ...(settings.length ? [{ id: 'settings', captioned: options.length > 0, node: <ToolRow><MorphRow slots={settings} gap={QUAD.gap} style={{ flex: '1 0 auto' }}/></ToolRow> }] : []),
  ];
  return [
    ...above.map(row => ({ ...row, node: <div style={{ paddingBottom: row.captioned ? CAPTION_HANG : 0 }}>{row.node}</div> })),
    // A tool pill's plate reaches `PLATE_PAD.y` above its row's box, which the spacing counts from.
    { id: 'tools', node: <div style={{ paddingTop: PLATE_PAD.y }}><ToolRow><MorphRow gap={QUAD.gap} style={{ flex: '1 1 0', minWidth: 0 }} slots={[
      { id: 'pills', flex: '0 1 auto', minWidth: 0,
        node: <PillRun><MorphRow slots={pills} gap={TOOL_PILL_GAP} attrs={pillAttrs} underlay={<ToolHighlight index={active}/>}/></PillRun> },
      ...toolEnd,
    ]}/></ToolRow></div> },
  ];
}

/** The fixed band a toolbar stands in against the bottom of the window. Rows above the tool row
 *  carry their own bottom gap, so a departing row keeps its place against the row below. On an
 *  upright window the toolbar is the panel standing on the bar in `tone`'s plate, its controls stacked. */
export function ToolbarHost({ spec, testId, mapEdge = true, tone = 'cream' }: { spec: ToolbarSpec; testId?: string; mapEdge?: boolean; tone?: BarPanel['tone'] }) {
  const layout = useFrameLayout();
  const { upright, root, reveal, content } = useBarSurface(tone, { foot: CAPTION_HANG + UPRIGHT_FOOT });
  const attrs = { 'data-testid': testId, ...spec.frameAttrs, ...(mapEdge ? mapEdgeAttr('bottom') : {}) };
  const slider = useBrushSizeWidths();
  const glide = usePlanGlide('frame.layout.adapt');
  if (upright && layout) {
    return <motion.div {...attrs} {...reveal} {...root}>
      <PanelTone tone={tone}><MorphRow column gap={UPRIGHT_SPACE.row} slots={uprightSlots(spec, slider)}/></PanelTone>
    </motion.div>;
  }
  const rows = spec.rows.map(row => ({ ...row, node: <div style={{ paddingBottom: SWATCH_ROW_GAP }}>{row.node}</div> }));
  return <div ref={root.ref} {...content.start} {...attrs} style={{
    position: 'fixed', left: QUAD.left, right: layout?.edgeRight ?? EDGE_RIGHT, bottom: (layout?.bar.bottom ?? 0) + QUAD.bottom, zIndex: z.panel,
    transition: glide(['right']),
    display: 'flex', flexDirection: 'column', pointerEvents: 'none',
  }}>
    <MorphRow column slots={rows}/>
    <ToolbarRow {...spec}/>
  </div>;
}
