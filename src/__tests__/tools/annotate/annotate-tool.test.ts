/**
 * The plan-notes tool, driven through a scripted ToolContext over the live store — the same
 * refresh-per-event shape ToolManager gives it. Cell coordinates only, so what passes here holds
 * in both views by construction. `halfCoord` is the pointer at half-cell precision, as the views
 * supply it; a zone cell (x, y) is drawn over [x - 0.5, x + 0.5), so a press at (x, y) lands in it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let multiHeld = false;
vi.mock('../../../core/runtime/modifier-state', async (importActual) => ({
  ...(await importActual<object>()),
  isMultiSelectHeld: () => multiHeld,
}));
import { AnnotateTool } from '../../../tools/annotate';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { makeTemplate } from '../../rules/_helpers';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents, MacroCoord } from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';
import { makeToolCtx } from '../_tool-ctx';
import type { ToolContext } from '../../../tools/runtime/types';
import type { ChipNote, RouteNote, ZoneNote } from '../../../core/model/annotations';
import { __resetCurveSession, isCurveSessionOpen, moveCurveAnchor } from '../../../tools/paint/curve-session';

const s = () => useEditorStore.getState();

/** A context wired to the live store the way ToolManager wires the real one, rebuilt per event. */
function liveCtx(over: Partial<ToolContext> = {}): ToolContext {
  const state = s().gridState!;
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return makeToolCtx(state, exec, 2, 1, {
    annotations: state.annotations ?? null,
    annotationTool: s().annotationTool,
    annotationZoneShape: s().annotationZoneShape,
    annotationColor: s().annotationColor,
    annotationTag: s().annotationTag,
    annotationSize: s().annotationSize,
    annotationRouteDashed: s().annotationRouteDashed,
    annotationSelection: s().annotationSelection,
    annotationDraft: s().annotationDraft,
    annotationEdit: {
      begin: () => s().beginAnnotationStroke(),
      apply: (fn) => s().applyAnnotationEdit(fn),
      add: (a) => s().addAnnotation(a),
      remove: (id) => s().removeAnnotation(id),
      select: (ids) => s().setAnnotationSelection(ids),
      setDraft: (a) => s().setAnnotationDraft(a),
      commitDraft: () => s().commitAnnotationDraft(),
    },
    tagLabel: (tag) => tag,
    ...over,
  });
}

const at = (x: number, y: number): MacroCoord => ({ x, y });
/** The press at an exact point: the view's half-cell reading. */
const press = (x: number, y: number) => liveCtx({ halfCoord: at(x, y) });
const items = () => s().gridState?.annotations?.items ?? [];
const zoneById = (id: string) => items().find((n) => n.id === id) as ZoneNote;
const rect = (x0: number, y0: number, x1: number, y1: number): MacroCoord[] => {
  const out: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
};
const zone = (id: string, cells: MacroCoord[], num = 1): ZoneNote =>
  ({ kind: 'zone', id, cells, color: '#2FBF9B', tag: 'farm', num });

function drag(tool: AnnotateTool, from: [number, number], to: [number, number]): void {
  tool.onPointerDown(at(Math.floor(from[0]), Math.floor(from[1])), at(0, 0), press(from[0], from[1]));
  tool.onPointerMove(at(Math.floor(to[0]), Math.floor(to[1])), at(0, 0), press(to[0], to[1]));
  tool.onPointerUp(at(Math.floor(to[0]), Math.floor(to[1])), at(0, 0), press(to[0], to[1]));
}

function click(tool: AnnotateTool, x: number, y: number): void {
  tool.onPointerDown(at(Math.floor(x), Math.floor(y)), at(0, 0), press(x, y));
  tool.onPointerUp(at(Math.floor(x), Math.floor(y)), at(0, 0), press(x, y));
}

describe('zones', () => {
  let tool: AnnotateTool;

  beforeEach(() => {
    tool = new AnnotateTool();
    multiHeld = false;
    __resetCurveSession();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().setAnnotationTool('zone');
  });

  it('strokes on open ground gather into one draft; Done commits it with the armed tag, selected', () => {
    s().setAnnotationTag('homes');
    drag(tool, [3, 3], [7, 3]);
    const first = (s().annotationDraft as ZoneNote).cells.length;
    expect(first).toBeGreaterThan(4);
    expect(items()).toHaveLength(0);
    drag(tool, [3, 9], [7, 9]);
    const draft = s().annotationDraft as ZoneNote;
    expect(draft.cells.length).toBeGreaterThan(first);
    expect(draft.tag).toBe('homes');
    expect(s().commitAnnotationDraft()).toBe(true);
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ kind: 'zone', tag: 'homes', num: 1 });
    expect(s().annotationSelection).toEqual([items()[0]!.id]);
    expect(s().annotationDraft).toBeNull();
  });

  it('a tap leaves a dab in the draft, so a single click still starts a zone', () => {
    click(tool, 5, 5);
    expect((s().annotationDraft as ZoneNote).cells.length).toBeGreaterThan(0);
  });

  it('a stroke that starts inside an existing zone grows that zone, as one lane entry', () => {
    s().addAnnotation(zone('z1', rect(4, 4, 6, 6)));
    const before = zoneById('z1').cells.length;
    const lanes = s().annotationUndoLane.length;
    drag(tool, [5, 5], [12, 5]);
    expect(zoneById('z1').cells.length).toBeGreaterThan(before);
    expect(zoneById('z1').cells.some((c) => c.x === 12)).toBe(true);
    expect(s().annotationDraft).toBeNull();
    expect(s().annotationUndoLane.length).toBe(lanes + 1);
    expect(s().undoAnnotation()).toBe(true);
    expect(zoneById('z1').cells).toHaveLength(before);
  });

  it('a click inside a zone selects it under the brush, and paints nothing', () => {
    s().addAnnotation(zone('z1', rect(4, 4, 6, 6)));
    click(tool, 5, 5);
    expect(s().annotationSelection).toEqual(['z1']);
    expect(zoneById('z1').cells).toHaveLength(9);
    expect(s().annotationDraft).toBeNull();
  });

  it('a stroke elsewhere clears a standing selection and still lands', () => {
    s().addAnnotation(zone('z1', rect(4, 4, 6, 6)));
    s().setAnnotationSelection(['z1']);
    drag(tool, [14, 14], [18, 14]);
    expect(s().annotationSelection).toEqual([]);
    expect(s().annotationDraft?.kind).toBe('zone');
  });

  it('Escape drops the draft and Discard leaves no note behind', () => {
    drag(tool, [3, 3], [7, 3]);
    expect(s().annotationDraft).not.toBeNull();
    s().setAnnotationDraft(null);
    expect(items()).toHaveLength(0);
  });

  it('a hidden or locked layer refuses edits but not selection', () => {
    s().addAnnotation(zone('z1', [at(4, 4)]));
    s().setAnnotationsLocked(true);
    drag(tool, [8, 8], [12, 8]);
    expect(s().annotationDraft).toBeNull();
    expect(items()).toHaveLength(1);
    s().setAnnotationTool('none');
    click(tool, 4, 4);
    expect(s().annotationSelection).toEqual(['z1']);
    tool.onPointerDown(at(4, 4), at(0, 0), press(4, 4));
    tool.onPointerMove(at(9, 4), at(0, 0), press(9, 4));
    expect(zoneById('z1').cells[0]).toEqual(at(4, 4));
  });
});

describe('the zone figures', () => {
  beforeEach(() => {
    __resetCurveSession();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().setAnnotationTool('zone');
  });

  it('a rectangle drags out into the draft, filled', () => {
    const tool = new AnnotateTool();
    s().setAnnotationZoneShape('rect');
    drag(tool, [2, 2], [5, 4]);
    expect((s().annotationDraft as ZoneNote).cells).toHaveLength(4 * 3);
  });

  it('a rectangle dragged from inside a zone adds to that zone', () => {
    const tool = new AnnotateTool();
    s().addAnnotation(zone('z1', rect(2, 2, 3, 3)));
    s().setAnnotationZoneShape('rect');
    drag(tool, [3, 3], [8, 6]);
    expect(zoneById('z1').cells.length).toBe(4 + 6 * 4 - 1);
    expect(s().annotationDraft).toBeNull();
  });

  it('a line lays a band along the drag', () => {
    const tool = new AnnotateTool();
    s().setAnnotationZoneShape('line');
    drag(tool, [2, 2], [8, 2]);
    const cells = (s().annotationDraft as ZoneNote).cells;
    expect(cells.length).toBeGreaterThan(6);
    expect(cells.some((c) => c.x === 2 && c.y === 2)).toBe(true);
    expect(cells.some((c) => c.x === 8 && c.y === 2)).toBe(true);
  });

  it('a curve collects anchors into the draft and a press back on the last one closes the band', () => {
    const tool = new AnnotateTool();
    s().setAnnotationZoneShape('curve');
    tool.onPointerDown(at(2, 2), at(0, 0), press(2, 2));
    tool.onPointerDown(at(8, 3), at(0, 0), press(8, 3));
    tool.onPointerDown(at(12, 8), at(0, 0), press(12, 8));
    expect(tool.hasPending(liveCtx())).toBe(true);
    tool.onPointerDown(at(12, 8), at(0, 0), press(12, 8));
    expect((s().annotationDraft as ZoneNote).cells.length).toBeGreaterThan(10);
    expect(tool.hasPending(liveCtx())).toBe(false);
    expect(items()).toHaveLength(0);
  });

  it('switching figures keeps the draft; the figure survives a put-away', () => {
    const tool = new AnnotateTool();
    drag(tool, [3, 3], [7, 3]);
    s().setAnnotationZoneShape('circle');
    s().setAnnotationTool('zone');
    expect(s().annotationDraft?.kind).toBe('zone');
    s().setAnnotationTool('none');
    expect(s().annotationDraft).toBeNull();
    s().setAnnotationTool('zone');
    expect(s().annotationZoneShape).toBe('circle');
  });
});

describe('the eraser', () => {
  let tool: AnnotateTool;

  beforeEach(() => {
    tool = new AnnotateTool();
    __resetCurveSession();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().setAnnotationTool('erase');
  });

  it('subtracts cells from every zone it crosses, as one lane entry per stroke', () => {
    s().addAnnotation(zone('z1', rect(2, 2, 12, 4)));
    const lanes = s().annotationUndoLane.length;
    drag(tool, [7, 3], [9, 3]);
    const left = zoneById('z1').cells;
    expect(left.length).toBeLessThan(33);
    expect(left.some((c) => c.x === 8 && c.y === 3)).toBe(false);
    expect(left.some((c) => c.x === 2 && c.y === 2)).toBe(true);
    expect(s().annotationUndoLane.length).toBe(lanes + 1);
  });

  it('a zone erased to nothing is removed', () => {
    s().addAnnotation(zone('z1', [at(5, 5)]));
    click(tool, 5, 5);
    expect(items()).toHaveLength(0);
  });

  it('a press on a chip or route removes that note', () => {
    s().addAnnotation({ kind: 'chip', id: 'c1', x: 5, y: 5, tag: 'plaza', size: 'm', color: '#FFB347' });
    click(tool, 5, 5);
    expect(items()).toHaveLength(0);
  });

  it('erases the draft too, which survives the switch to the eraser', () => {
    s().setAnnotationTool('zone');
    drag(tool, [3, 3], [9, 3]);
    const before = (s().annotationDraft as ZoneNote).cells.length;
    s().setAnnotationTool('erase');
    expect(s().annotationDraft).not.toBeNull();
    click(tool, 6, 3);
    expect((s().annotationDraft as ZoneNote).cells.length).toBeLessThan(before);
  });
});

describe('chips', () => {
  it('one press drops the armed tag on a plate, selected', () => {
    const tool = new AnnotateTool();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().setAnnotationTool('chip');
    s().setAnnotationTag('landmark');
    s().setAnnotationSize('l');
    click(tool, 5.5, 6.5);
    const chip = items()[0] as ChipNote;
    expect(chip).toMatchObject({ kind: 'chip', tag: 'landmark', size: 'l', x: 5.5, y: 6.5 });
    expect(s().annotationSelection).toEqual([chip.id]);
  });
});

describe('routes', () => {
  let tool: AnnotateTool;

  beforeEach(() => {
    tool = new AnnotateTool();
    __resetCurveSession();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().setAnnotationTool('route');
  });

  it('a drag draws a route in one stroke, simplified to the anchors that shape it', () => {
    tool.onPointerDown(at(2, 2), at(0, 0), press(2, 2));
    for (let x = 3; x <= 10; x++) tool.onPointerMove(at(x, 2), at(0, 0), press(x, 2));
    for (let y = 3; y <= 8; y++) tool.onPointerMove(at(10, y), at(0, 0), press(10, y));
    tool.onPointerUp(at(10, 8), at(0, 0), press(10, 8));
    const route = items()[0] as RouteNote;
    expect(route.kind).toBe('route');
    expect(route.points).toHaveLength(3);
    expect(route.points[0]).toEqual({ x: 2, y: 2 });
    expect(route.points[2]).toEqual({ x: 10, y: 8 });
    expect(s().annotationDraft).toBeNull();
    expect(s().annotationSelection).toEqual([route.id]);
    expect(isCurveSessionOpen()).toBe(true);
  });

  it('a press that does not move lays a waypoint, and a press back on the last one finishes', () => {
    click(tool, 2, 2);
    click(tool, 8, 2);
    click(tool, 8, 8);
    expect((s().annotationDraft as RouteNote).points).toHaveLength(3);
    expect(tool.hasPending(liveCtx())).toBe(true);
    click(tool, 8, 8);
    expect(items()).toHaveLength(1);
    expect((items()[0] as RouteNote).points).toHaveLength(3);
    expect(s().annotationDraft).toBeNull();
    expect(tool.hasPending(liveCtx())).toBe(false);
  });

  it('a press near an existing route selects it and raises its handles instead of starting another', () => {
    __resetCurveSession();
    s().addAnnotation({ kind: 'route', id: 'r1', points: [{ x: 2, y: 10 }, { x: 12, y: 10 }], color: '#38BDF8', dashed: true });
    tool.onPointerDown(at(7, 10), at(0, 0), press(7, 10.2));
    expect(s().annotationSelection).toEqual(['r1']);
    expect(s().annotationDraft).toBeNull();
    expect(isCurveSessionOpen()).toBe(true);
    expect(items()).toHaveLength(1);
  });

  it('a finished route keeps its anchors up for tuning, and one drag is one undo entry', () => {
    click(tool, 2, 2);
    click(tool, 8, 2);
    click(tool, 8, 2);
    expect(isCurveSessionOpen()).toBe(true);
    const lanes = s().annotationUndoLane.length;
    moveCurveAnchor(1, 8.5, 6.5, false);
    moveCurveAnchor(1, 9.5, 8.5, true);
    const route = items()[0] as RouteNote;
    expect(route.points[1]).toMatchObject({ x: 9.5, y: 8.5 });
    expect(s().annotationUndoLane.length).toBe(lanes + 1);
    // The next press puts the handles down and mints nothing.
    tool.onPointerDown(at(12, 12), at(0, 0), press(12, 12));
    expect(isCurveSessionOpen()).toBe(false);
    expect(s().annotationDraft).toBeNull();
    expect(items()).toHaveLength(1);
  });

  it('a bar press that clears the draft clears the pending answer with it', () => {
    click(tool, 2, 2);
    expect(tool.hasPending(liveCtx())).toBe(true);
    s().setAnnotationTool('zone');
    expect(s().annotationDraft).toBeNull();
    expect(tool.hasPending(liveCtx())).toBe(false);
  });

  it('escape abandons a route draft and delete takes back its last waypoint', () => {
    click(tool, 2, 2);
    click(tool, 6, 2);
    expect(tool.undoPendingStep(liveCtx())).toBe(true);
    expect((s().annotationDraft as RouteNote).points).toHaveLength(1);
    expect(tool.cancelPending(liveCtx())).toBe(true);
    expect(s().annotationDraft).toBeNull();
  });
});

describe('the select state', () => {
  let tool: AnnotateTool;

  beforeEach(() => {
    tool = new AnnotateTool();
    multiHeld = false;
    __resetCurveSession();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().addAnnotation(zone('z1', [at(4, 8), at(5, 8)], 1));
    s().addAnnotation({ ...zone('z2', [at(12, 8), at(13, 8)], 2), color: '#3B82F6' });
    s().setAnnotationTool('none');
  });

  it('a press selects and a drag moves, as one undo entry', () => {
    s().addAnnotation({ kind: 'chip', id: 'c1', x: 5.5, y: 15.5, tag: 'plaza', size: 'm', color: '#FFB347' });
    tool.onPointerDown(at(5, 15), at(0, 0), press(5.5, 15.5));
    expect(s().annotationSelection).toEqual(['c1']);
    tool.onPointerMove(at(8, 15), at(0, 0), press(8.5, 15.5));
    tool.onPointerMove(at(9, 15), at(0, 0), press(9.5, 15.5));
    tool.onPointerUp(at(9, 15), at(0, 0), press(9.5, 15.5));
    const moved = items().find((n) => n.id === 'c1') as ChipNote;
    expect(moved.x).toBe(9.5);
    expect(s().undoAnnotation()).toBe(true);
    expect((items().find((n) => n.id === 'c1') as ChipNote).x).toBe(5.5);
  });

  it('grabAt answers the select state only, and only over a note', () => {
    expect(tool.grabAt(at(4, 8), press(4, 8))).toBe(true);
    expect(tool.grabAt(at(20, 20), press(20.5, 20.5))).toBe(false);
    s().setAnnotationTool('zone');
    expect(tool.grabAt(at(4, 8), press(4, 8))).toBe(false);
    s().setAnnotationTool('none');
    s().setAnnotationsVisible(false);
    expect(tool.grabAt(at(4, 8), press(4, 8))).toBe(false);
  });

  it('selects and selectHit publish the select-state facts the modifier cursor reads', () => {
    expect(tool.selects(liveCtx())).toBe(true);
    useEditorStore.setState({ annotationSelection: ['z1'] });
    expect(tool.selectHit(at(4, 8), press(4, 8))).toEqual({ id: 'z1', selected: true });
    expect(tool.selectHit(at(12, 8), press(12, 8))).toEqual({ id: 'z2', selected: false });
    expect(tool.selectHit(at(20, 20), press(20.5, 20.5))).toBeNull();
    s().setAnnotationTool('zone');
    expect(tool.selects(liveCtx())).toBe(false);
    s().setAnnotationTool('none');
    s().setAnnotationsVisible(false);
    expect(tool.selects(liveCtx())).toBe(false);
  });

  it('ctrl toggles members in and out without arming a drag', () => {
    tool.onPointerDown(at(4, 8), at(0, 0), press(4, 8));
    expect(s().annotationSelection).toEqual(['z1']);
    multiHeld = true;
    tool.onPointerDown(at(12, 8), at(0, 0), press(12, 8));
    expect(s().annotationSelection).toEqual(['z1', 'z2']);
    tool.onPointerDown(at(4, 8), at(0, 0), press(4, 8));
    expect(s().annotationSelection).toEqual(['z2']);
    tool.onPointerDown(at(20, 20), at(0, 0), press(20.5, 20.5));
    expect(s().annotationSelection).toEqual(['z2']);
  });

  it('a plain drag on a member moves the WHOLE set', () => {
    s().setAnnotationSelection(['z1', 'z2']);
    tool.onPointerDown(at(4, 8), at(0, 0), press(4, 8));
    expect(s().annotationSelection).toEqual(['z1', 'z2']);
    tool.onPointerMove(at(6, 10), at(0, 0), press(6, 10));
    tool.onPointerUp(at(6, 10), at(0, 0), press(6, 10));
    expect(zoneById('z1').cells[0]).toEqual(at(6, 10));
    expect(zoneById('z2').cells[0]).toEqual(at(14, 10));
  });
});
