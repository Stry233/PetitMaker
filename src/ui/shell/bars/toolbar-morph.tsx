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
import { seconds, cssMotion } from '../../design/motion';
import { z } from '../../design/styles';
import { INK } from '../../design/tokens';
import { useFrameLayout } from '../frame-layout';
import { useTransition } from '../../design/motion/use-motion';
import { EDGE_RIGHT, QUAD } from '../units';
import { CELL_BOX } from './terrain-cells';
import { ToolHighlight, TOOL_PILL_GAP } from './ToolPill';
import { SWATCH_ROW_GAP, ToolRow } from './ToolRow';

export interface ToolbarSlot {
  /** What the control means. Two tools offering the same control give it the same id. */
  id: string;
  node: ReactNode;
  /** Stands at the far end of its row. */
  end?: boolean;
  /** The node plays its own entrance and exit. */
  ownMotion?: boolean;
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
class SlotFlip extends Component<{ registry: Map<string, SlotHandle>; reduced: boolean; transition: Transition; children: ReactNode }> {
  getSnapshotBeforeUpdate(): Map<string, Place> {
    const before = new Map<string, Place>();
    for (const [id, handle] of this.props.registry) {
      if (!handle.outer || handle.popped) continue;
      const place = placeOf(handle.outer);
      if (place) before.set(id, place);
    }
    return before;
  }

  componentDidUpdate(_props: unknown, _state: unknown, before: Map<string, Place>): void {
    const { registry, reduced, transition } = this.props;
    for (const [id, handle] of registry) {
      if (handle.present || handle.popped || !handle.outer) continue;
      const place = before.get(id);
      if (place) pop(handle.outer, place);
      handle.popped = true;
    }
    if (reduced) return;
    for (const [id, handle] of registry) {
      const from = before.get(id);
      if (!handle.present || !handle.outer || !from) continue;
      const to = placeOf(handle.outer);
      if (!to) continue;
      const dx = from.x - to.x, dy = from.y - to.y;
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
  handle.current ??= { outer: null, x, y, running: [], present: true, popped: false };
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
    // A control that returns before its departure finished rejoins the flow.
    if (present && own.popped && own.outer) { unpop(own.outer); own.popped = false; }
  });

  const fade = slot.ownMotion ? {} : {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { ...enter, delay } },
    exit: { opacity: 0, transition: leave },
  };
  return <div ref={outer} data-toolbar-slot={slot.id} aria-hidden={!present || undefined} {...(!present ? { inert: '' } : {})}
    style={{ flex: 'none', marginLeft: slot.end ? 'auto' : undefined }}>
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
  const registry = useRef(new Map<string, SlotHandle>()).current;
  const transition = useTransition('tool.control.morph') as Transition;
  const previous = useRef<readonly string[]>(slots.map(slot => slot.id));
  const leaving = previous.current.some(id => !slots.some(slot => slot.id === id));
  useLayoutEffect(() => { previous.current = slots.map(slot => slot.id); });
  // Arrivals wait for departures so two controls never stand in one place at once.
  const delay = leaving && !reduced ? seconds('tool.control.leave') : 0;
  const body = slots.map(slot => <Slot key={slot.id} slot={slot} delay={delay}/>);
  return <SlotRegistry.Provider value={registry}>
    <SlotFlip registry={registry} reduced={reduced} transition={transition}>
      <div {...attrs} style={{
        position: 'relative', display: 'flex', flexDirection: column ? 'column' : 'row',
        alignItems: column ? 'stretch' : 'flex-start', gap, ...style,
      }}>
        {underlay}
        {reduced ? body : <AnimatePresence initial={false}>{body}</AnimatePresence>}
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

/** The fixed band a toolbar stands in against the bottom of the window. Rows above the tool row
 *  carry their own bottom gap, so a departing row keeps its place against the row below. */
export function ToolbarHost({ spec, testId, mapEdge = true }: { spec: ToolbarSpec; testId?: string; mapEdge?: boolean }) {
  const layout = useFrameLayout();
  const rows = spec.rows.map(row => ({ ...row, node: <div style={{ paddingBottom: SWATCH_ROW_GAP }}>{row.node}</div> }));
  return <div data-testid={testId} {...spec.frameAttrs} {...(mapEdge ? mapEdgeAttr('bottom') : {})} style={{
    position: 'fixed', left: QUAD.left, right: layout?.edgeRight ?? EDGE_RIGHT, bottom: QUAD.bottom, zIndex: z.panel,
    transition: cssMotion('frame.layout.adapt', ['right']),
    display: 'flex', flexDirection: 'column', pointerEvents: 'none',
  }}>
    <MorphRow column slots={rows}/>
    <ToolbarRow {...spec}/>
  </div>;
}
