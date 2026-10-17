/**
 * The plan-notes tool, driven through a scripted HostedToolContext over the live store — the same
 * refresh-per-event shape ToolManager gives it. Cell coordinates only, so what passes here holds
 * in both views by construction. `point` is the pointer's map point, as the views
 * supply it. Zones and measurements step in half cells, centred on the half-cell point nearest the
 * pointer, so a press at a cell's centre (`mid`) lands on that whole cell and a press at its corner
 * lands half a cell up and left of it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let multiHeld = false;
import { AnnotateTool } from '../../../../tools/pointer/annotate';
import { useEditorStore } from '../../../../state/store';
import { createDefaultRegistry } from '../../../../rules/index';
import { makeTemplate, makeExecutor } from '../../../_support/map-state';
import type { MacroCoord } from '../../../../core/model/types';
import { makeToolCtx, type ToolCtxOver } from '../../../_support/tool-ctx';
import type { HostedToolContext } from '../../../../tools/pointer/runtime/host';
import type { ChipNote, MapAnnotation, MeasureNote, RouteNote, ZoneNote } from '../../../../core/model/annotations';
import { cellEdges, measureDrawing } from '../../../../core/model/annotation/dimensions';
import { __resetCurveSession, isCurveSessionOpen, moveCurveAnchor } from '../../../_support/curve-session';
import { brushCells, dragShapeCells, line4, splineCells } from '../../../../core/grid/shapes';
import { annotationInkScale } from '../../../../core/model/annotation/text-metrics';
import { cell, point } from '../../../_support/grid';
import { brushSizeOf } from '../../../../state/editing/edit-mode';
import { armingOf } from '../../../../state/editing/arming';

const s = () => useEditorStore.getState();

/** A context wired to the live store the way ToolManager wires the real one, rebuilt per event. */
function liveCtx(over: ToolCtxOver = {}): HostedToolContext {
  const state = s().gridState!;
  const exec = makeExecutor(state);
  return makeToolCtx(state, exec, 2, 1, {
    annotationTool: s().annotationTool,
    annotationZoneShape: s().annotationZoneShape,
    eraserShape: s().eraserShape,
    annotationColor: s().annotationColor,
    annotationTag: s().annotationTag,
    annotationSize: s().annotationSize,
    annotationRouteDashed: s().annotationRouteDashed,
    annotationRouteWidth: s().annotationRouteWidth,
    notes: armingOf(s()).notes,
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
    modifiers: { constrain: false, get multiSelect() { return multiHeld; } },
    ...over,
  });
}

const at = (x: number, y: number): MacroCoord => ({ x, y });
/** The centre of cell (x, y). */
const mid = (x: number, y: number): [number, number] => [x + 0.5, y + 0.5];
/** The press at an exact point: the view's half-cell reading. */
const press = (x: number, y: number) => liveCtx({ point: point(at(x, y)) });
const items = () => s().gridState?.annotations?.items ?? [];
const zoneById = (id: string) => items().find((n) => n.id === id) as ZoneNote;
const rect = (x0: number, y0: number, x1: number, y1: number): MacroCoord[] => {
  const out: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
};
const zone = (id: string, cells: MacroCoord[], num = 1): ZoneNote =>
  ({ kind: 'zone', id, cells, color: '#2FBF9B', tag: 'farm', num });

describe('annotation brush previews', () => {
  beforeEach(() => {
    s().initMap(makeTemplate(40, 40), createDefaultRegistry());
    useEditorStore.setState({ annotationTool: 'zone', annotationZoneShape: 'free', annotationDraft: null, annotationDiscardAction: null });
  });

  it.each(['free', 'line', 'rect', 'circle', 'curve'] as const)('%s previews the cells painted by a tap without creating a draft on hover', shape => {
    s().setAnnotationZoneShape(shape);
    const tool = new AnnotateTool();
    const ctx = press(12, 12);
    const show = vi.spyOn(ctx.overlay, 'showGhost');
    const before = s().annotationUndoLane.length;
    tool.onPointerMove(cell(at(12, 12)), point(at(0, 0)), ctx);
    const ghost = show.mock.calls[show.mock.calls.length - 1]![0];
    expect(ghost.cells.length).toBeGreaterThan(0);
    expect(s().annotationDraft).toBeNull();
    expect(s().annotationUndoLane.length).toBe(before);
    tool.onPointerDown(cell(at(12, 12)), point(at(0, 0)), ctx);
    expect((s().annotationDraft as ZoneNote).cells).toEqual(ghost.cells);
  });

  it('eraser previews exactly the cells removed from a zone', () => {
    s().addAnnotation(zone('test-zone', rect(0, 0, 30, 30)));
    s().setAnnotationTool('erase');
    const tool = new AnnotateTool();
    const ctx = press(...mid(12, 12));
    const show = vi.spyOn(ctx.overlay, 'showGhost');
    tool.onPointerMove(cell(at(12, 12)), point(at(0, 0)), ctx);
    const cells = show.mock.calls[show.mock.calls.length - 1]![0].cells;
    const before = zoneById('test-zone').cells;
    tool.onPointerDown(cell(at(12, 12)), point(at(0, 0)), ctx);
    expect(before.filter(c => !zoneById('test-zone').cells.some(after => after.x === c.x && after.y === c.y))).toEqual(cells);
  });

  it('clears the preview when editing is unavailable or the tool leaves', () => {
    const tool = new AnnotateTool();
    s().setAnnotationsLocked(true);
    const ctx = press(12, 12);
    const clear = vi.spyOn(ctx.overlay, 'clearGhost');
    const show = vi.spyOn(ctx.overlay, 'showGhost');
    tool.onPointerMove(cell(at(12, 12)), point(at(0, 0)), ctx);
    expect(show).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    clear.mockClear();
    tool.onDeactivate(ctx);
    expect(clear).toHaveBeenCalled();
  });
});

function drag(tool: AnnotateTool, from: [number, number], to: [number, number]): void {
  tool.onPointerDown(cell(at(Math.floor(from[0]), Math.floor(from[1]))), point(at(0, 0)), press(from[0], from[1]));
  tool.onPointerMove(cell(at(Math.floor(to[0]), Math.floor(to[1]))), point(at(0, 0)), press(to[0], to[1]));
  tool.onPointerUp(cell(at(Math.floor(to[0]), Math.floor(to[1]))), point(at(0, 0)), press(to[0], to[1]));
}

function click(tool: AnnotateTool, x: number, y: number): void {
  tool.onPointerDown(cell(at(Math.floor(x), Math.floor(y))), point(at(0, 0)), press(x, y));
  tool.onPointerUp(cell(at(Math.floor(x), Math.floor(y))), point(at(0, 0)), press(x, y));
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
    tool.onPointerDown(cell(at(4, 4)), point(at(0, 0)), press(4, 4));
    tool.onPointerMove(cell(at(9, 4)), point(at(0, 0)), press(9, 4));
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
    drag(tool, mid(2, 2), mid(5, 4));
    expect((s().annotationDraft as ZoneNote).cells).toHaveLength(4 * 3);
  });

  it('a rectangle dragged from inside a zone adds to that zone', () => {
    const tool = new AnnotateTool();
    s().addAnnotation(zone('z1', rect(2, 2, 3, 3)));
    s().setAnnotationZoneShape('rect');
    drag(tool, mid(3, 3), mid(8, 6));
    expect(zoneById('z1').cells.length).toBe(4 + 6 * 4 - 1);
    expect(s().annotationDraft).toBeNull();
  });

  it('a line lays a band along the drag', () => {
    const tool = new AnnotateTool();
    s().setAnnotationZoneShape('line');
    drag(tool, mid(2, 2), mid(8, 2));
    const cells = (s().annotationDraft as ZoneNote).cells;
    expect(cells.length).toBeGreaterThan(6);
    expect(cells.some((c) => c.x === 2 && c.y === 2)).toBe(true);
    expect(cells.some((c) => c.x === 8 && c.y === 2)).toBe(true);
  });

  it('a curve collects anchors into the draft and a press back on the last one closes the band', () => {
    const tool = new AnnotateTool();
    s().setAnnotationZoneShape('curve');
    tool.onPointerDown(cell(at(2, 2)), point(at(0, 0)), press(2, 2));
    tool.onPointerDown(cell(at(8, 3)), point(at(0, 0)), press(8, 3));
    tool.onPointerDown(cell(at(12, 8)), point(at(0, 0)), press(12, 8));
    expect(tool.hasPending(liveCtx())).toBe(true);
    tool.onPointerDown(cell(at(12, 8)), point(at(0, 0)), press(12, 8));
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
    expect(s().annotationDiscardAction).not.toBeNull();
    s().confirmAnnotationDiscard();
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
    drag(tool, mid(7, 3), mid(9, 3));
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
  beforeEach(() => { multiHeld = false; __resetCurveSession(); });

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

  it.each(['none', 'chip'] as const)('%s requires a separate selection before moving a tag', (mode) => {
    const tool = new AnnotateTool();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().addAnnotation({ kind: 'chip', id: 'tag', x: 6, y: 6, tag: 'plaza', size: 'm', color: '#FFB347' });
    s().setAnnotationTool(mode);
    s().setAnnotationSelection([]);
    expect(tool.grabAt(at(6, 6), press(6, 6))).toBe(false);
    drag(tool, [6, 6], [9, 8]);
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ x: 6, y: 6 });
    expect(s().annotationSelection).toEqual(['tag']);
    expect(tool.grabAt(at(6, 6), press(6, 6))).toBe(true);
    drag(tool, [6, 6], [9, 8]);
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ x: 9, y: 8 });
    expect(s().undoAnnotation()).toBe(true);
    expect(items()[0]).toMatchObject({ x: 6, y: 6 });
  });

  it('selects a tag near its edge without creating an overlapping plate', () => {
    const tool = new AnnotateTool();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().addAnnotation({ kind: 'chip', id: 'tag', x: 6, y: 6, tag: 'plaza', size: 'm', color: '#FFB347' });
    s().setAnnotationTool('chip');
    s().setAnnotationSelection([]);
    click(tool, 6, 6.9);
    expect(items()).toHaveLength(1);
    expect(s().annotationSelection).toEqual(['tag']);
    click(tool, 20, 20);
    expect(items()).toHaveLength(2);
  });

  it('selects a locked tag without moving or duplicating it', () => {
    const tool = new AnnotateTool();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().addAnnotation({ kind: 'chip', id: 'tag', x: 6, y: 6, tag: 'plaza', size: 'm', color: '#FFB347' });
    s().setAnnotationTool('chip');
    s().setAnnotationSelection([]);
    s().setAnnotationsLocked(true);
    click(tool, 6, 6);
    expect(s().annotationSelection).toEqual(['tag']);
    expect(tool.grabAt(at(6, 6), press(6, 6))).toBe(false);
    drag(tool, [6, 6], [9, 8]);
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ x: 6, y: 6 });
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
    tool.onPointerDown(cell(at(2, 2)), point(at(0, 0)), press(2, 2));
    for (let x = 3; x <= 10; x++) tool.onPointerMove(cell(at(x, 2)), point(at(0, 0)), press(x, 2));
    for (let y = 3; y <= 8; y++) tool.onPointerMove(cell(at(10, y)), point(at(0, 0)), press(10, y));
    tool.onPointerUp(cell(at(10, 8)), point(at(0, 0)), press(10, 8));
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
    tool.onPointerDown(cell(at(7, 10)), point(at(0, 0)), press(7, 10.2));
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
    tool.onPointerDown(cell(at(12, 12)), point(at(0, 0)), press(12, 12));
    expect(isCurveSessionOpen()).toBe(false);
    expect(s().annotationDraft).toBeNull();
    expect(items()).toHaveLength(1);
  });

  it('confirming a tool switch clears the route draft and its pending points', () => {
    click(tool, 2, 2);
    expect(tool.hasPending(liveCtx())).toBe(true);
    s().setAnnotationTool('zone');
    expect(s().annotationDiscardAction).not.toBeNull();
    s().confirmAnnotationDiscard();
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

describe('putting down a drawing tool during a drag', () => {
  it.each(['zone', 'route', 'measure'] as const)('Escape cancels an active %s drag without reviving its draft', (kind) => {
    const tool = new AnnotateTool();
    __resetCurveSession();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().setAnnotationTool(kind);
    tool.onPointerDown(cell(at(3, 3)), point(at(0, 0)), press(3, 3));
    expect(tool.cancelPending(liveCtx())).toBe(true);
    s().setAnnotationTool('none');
    tool.onPointerMove(cell(at(8, 3)), point(at(0, 0)), press(8, 3));
    tool.onPointerUp(cell(at(8, 3)), point(at(0, 0)), press(8, 3));
    expect(s().annotationDraft).toBeNull();
    expect(items()).toEqual([]);
  });

  it.each(['zone', 'route', 'measure'] as const)('confirming a shortcut switch discards %s before pointer release', (kind) => {
    const tool = new AnnotateTool();
    __resetCurveSession();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().setAnnotationTool(kind);
    tool.onPointerDown(cell(at(3, 3)), point(at(0, 0)), press(3, 3));
    s().toggleAnnotationTool(kind);
    expect(s().annotationDraft).not.toBeNull();
    s().confirmAnnotationDiscard();
    tool.onPointerMove(cell(at(8, 3)), point(at(0, 0)), press(8, 3));
    tool.onPointerUp(cell(at(8, 3)), point(at(0, 0)), press(8, 3));
    expect(s().annotationDraft).toBeNull();
    expect(items()).toEqual([]);
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

  it('a press selects and a subsequent drag moves, as one undo entry', () => {
    s().addAnnotation({ kind: 'chip', id: 'c1', x: 5.5, y: 15.5, tag: 'plaza', size: 'm', color: '#FFB347' });
    tool.onPointerDown(cell(at(5, 15)), point(at(0, 0)), press(5.5, 15.5));
    expect(s().annotationSelection).toEqual(['c1']);
    tool.onPointerUp(cell(at(5, 15)), point(at(0, 0)), press(5.5, 15.5));
    tool.onPointerDown(cell(at(5, 15)), point(at(0, 0)), press(5.5, 15.5));
    tool.onPointerMove(cell(at(8, 15)), point(at(0, 0)), press(8.5, 15.5));
    tool.onPointerMove(cell(at(9, 15)), point(at(0, 0)), press(9.5, 15.5));
    tool.onPointerUp(cell(at(9, 15)), point(at(0, 0)), press(9.5, 15.5));
    const moved = items().find((n) => n.id === 'c1') as ChipNote;
    expect(moved.x).toBe(9.5);
    expect(s().undoAnnotation()).toBe(true);
    expect((items().find((n) => n.id === 'c1') as ChipNote).x).toBe(5.5);
  });

  it('moves a selected note on an engine with no structuredClone', () => {
    // Safari before 15.4 has none. The drag snapshot is plain planning data either way.
    vi.stubGlobal('structuredClone', undefined);
    try {
      s().addAnnotation({ kind: 'chip', id: 'c2', x: 5.5, y: 15.5, tag: 'plaza', size: 'm', color: '#FFB347' });
      tool.onPointerDown(cell(at(5, 15)), point(at(0, 0)), press(5.5, 15.5));
      tool.onPointerUp(cell(at(5, 15)), point(at(0, 0)), press(5.5, 15.5));
      tool.onPointerDown(cell(at(5, 15)), point(at(0, 0)), press(5.5, 15.5));
      tool.onPointerMove(cell(at(9, 15)), point(at(0, 0)), press(9.5, 15.5));
      tool.onPointerUp(cell(at(9, 15)), point(at(0, 0)), press(9.5, 15.5));
      expect((items().find((n) => n.id === 'c2') as ChipNote).x).toBe(9.5);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('drags a zone from its own snapshot, so the offset is measured from where the press began', () => {
    // The snapshot must be independent of the live items: reading them back mid-drag would add
    // each frame's move to the last.
    s().setAnnotationSelection(['z1']);
    tool.onPointerDown(cell(at(4, 8)), point(at(0, 0)), press(4, 8));
    tool.onPointerMove(cell(at(6, 8)), point(at(0, 0)), press(6, 8));
    tool.onPointerMove(cell(at(8, 8)), point(at(0, 0)), press(8, 8));
    tool.onPointerUp(cell(at(8, 8)), point(at(0, 0)), press(8, 8));
    expect((items().find((n) => n.id === 'z1') as ZoneNote).cells.map((c) => c.x)).toEqual([8, 9]);
  });

  it('grabAt requires an already-selected note and an editable layer', () => {
    expect(tool.grabAt(at(4, 8), press(4, 8))).toBe(false);
    s().setAnnotationSelection(['z1']);
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
    tool.onPointerDown(cell(at(4, 8)), point(at(0, 0)), press(4, 8));
    expect(s().annotationSelection).toEqual(['z1']);
    multiHeld = true;
    tool.onPointerDown(cell(at(12, 8)), point(at(0, 0)), press(12, 8));
    expect(s().annotationSelection).toEqual(['z1', 'z2']);
    tool.onPointerDown(cell(at(4, 8)), point(at(0, 0)), press(4, 8));
    expect(s().annotationSelection).toEqual(['z2']);
    tool.onPointerDown(cell(at(20, 20)), point(at(0, 0)), press(20.5, 20.5));
    expect(s().annotationSelection).toEqual(['z2']);
  });

  it('a plain drag on a member moves the WHOLE set', () => {
    s().setAnnotationSelection(['z1', 'z2']);
    tool.onPointerDown(cell(at(4, 8)), point(at(0, 0)), press(4, 8));
    expect(s().annotationSelection).toEqual(['z1', 'z2']);
    tool.onPointerMove(cell(at(6, 10)), point(at(0, 0)), press(6, 10));
    tool.onPointerUp(cell(at(6, 10)), point(at(0, 0)), press(6, 10));
    expect(zoneById('z1').cells[0]).toEqual(at(6, 10));
    expect(zoneById('z2').cells[0]).toEqual(at(14, 10));
  });
});

describe('measurements', () => {
  let tool: AnnotateTool;
  beforeEach(() => {
    tool = new AnnotateTool(); multiHeld = false; __resetCurveSession();
    s().initMap(makeTemplate(100, 100), createDefaultRegistry());
    s().setAnnotationTool('measure');
  });
  it('previews between clicks and commits one measurement with two snapped endpoints', () => {
    click(tool, ...mid(1, 4));
    expect(tool.hasPending(liveCtx())).toBe(true);
    tool.onPointerMove(cell(at(84, 4)), point(at(0, 0)), press(...mid(84.1, 4.1)));
    expect(items()).toHaveLength(0);
    expect(s().annotationDraft).toMatchObject({ kind: 'measure', points: [at(1, 4), at(84, 4)] });
    click(tool, ...mid(84, 4));
    expect(items()).toHaveLength(1);
    expect(s().annotationDraft).toBeNull();
    expect(s().annotationSelection).toEqual([items()[0]!.id]);
    expect(s().undoAnnotation()).toBe(true); expect(items()).toHaveLength(0);
    expect(s().redoAnnotation()).toBe(true); expect(items()).toHaveLength(1);
  });
  it('supports dragging and counting a single cell with two taps', () => {
    drag(tool, mid(3, 5), mid(12, 17));
    expect(items()[0]).toMatchObject({ kind: 'measure', points: [at(3, 5), at(3, 17)] });
    click(tool, ...mid(20, 20)); click(tool, ...mid(20, 20));
    expect(items()[1]).toMatchObject({ points: [at(20, 20), at(20, 20)] });
  });
  it.each([
    [[24, 13], [24, 10]], [[12, 26], [10, 26]],
    [[24, 19], [24, 10]], [[1, 3], [1, 10]], [[3, 19], [10, 19]], [[20, 20], [20, 10]],
  ])('snaps a drag toward %j to its nearest row or column', (end, expected) => {
    drag(tool, mid(10, 10), mid(...(end as [number, number])));
    expect(items()[0]).toMatchObject({ points: [at(10, 10), at(expected[0]!, expected[1]!)] });
  });
  it('previews direction changes between taps and snaps the final release', () => {
    click(tool, ...mid(10, 10));
    tool.onPointerMove(cell(at(24, 13)), point(at(0, 0)), press(...mid(24, 13)));
    expect(s().annotationDraft).toMatchObject({ points: [at(10, 10), at(24, 10)] });
    tool.onPointerMove(cell(at(13, 24)), point(at(0, 0)), press(...mid(13, 24)));
    expect(s().annotationDraft).toMatchObject({ points: [at(10, 10), at(10, 24)] });
    click(tool, ...mid(13, 24));
    expect(items()[0]).toMatchObject({ points: [at(10, 10), at(10, 24)] });
    tool.onPointerDown(cell(at(40, 40)), point(at(0, 0)), press(...mid(40, 40)));
    tool.onPointerMove(cell(at(54, 43)), point(at(0, 0)), press(...mid(54, 43)));
    tool.onPointerUp(cell(at(43, 54)), point(at(0, 0)), press(...mid(43, 54)));
    expect(items()[1]).toMatchObject({ points: [at(40, 40), at(40, 54)] });
  });
  it('cancels a pending measurement and cancels touch navigation without committing', () => {
    click(tool, ...mid(1, 1)); expect(tool.undoPendingStep(liveCtx())).toBe(true);
    expect(s().annotationDraft).toBeNull();
    tool.onPointerDown(cell(at(2, 2)), point(at(0, 0)), press(...mid(2, 2)));
    tool.onPointerMove(cell(at(20, 20)), point(at(0, 0)), press(...mid(20, 20)));
    tool.onPointerCancel(liveCtx());
    expect(s().annotationDraft).toBeNull(); expect(items()).toHaveLength(0);
  });
  it('selects and moves a measurement in half-cell steps, and erases its dimension line', () => {
    drag(tool, mid(3, 5), mid(12, 5));
    s().setAnnotationTool('none');
    // The span's box runs along the top edge of row 5, on the road grid.
    click(tool, 6, 5);
    expect(s().annotationSelection).toHaveLength(1);
    drag(tool, [6, 5], [8.3, 7.6]);
    expect(items()[0]).toMatchObject({ points: [at(5.5, 7.5), at(14.5, 7.5)] });
    s().setAnnotationTool('erase'); click(tool, 8, 7.5);
    expect(items()).toHaveLength(0);
  });
  it('respects layer visibility and locks and does not apply tag or text size to dimensions', () => {
    drag(tool, mid(3, 5), mid(12, 5));
    const before = items()[0];
    s().setAnnotationTag('forest'); s().setAnnotationSize('l');
    expect(items()[0]).toBe(before);
    s().setAnnotationsLocked(true); click(tool, ...mid(2, 2));
    expect(s().annotationDraft).toBeNull();
    s().setAnnotationsLocked(false); s().setAnnotationsVisible(false); click(tool, ...mid(2, 2));
    expect(s().annotationDraft).toBeNull();
  });
});

it('uses the rendered tag hit for selection and treats its miss as authoritative', () => {
  const tool = new AnnotateTool();
  s().initMap(makeTemplate(24, 24), createDefaultRegistry());
  s().addAnnotation({ kind: 'chip', id: 'tag', x: 5, y: 5, tag: 'homes', size: 'l', color: '#FFB347' });
  s().setAnnotationTool('chip');
  const labelCtx = liveCtx({ point: point(at(15, 15)), annotationLabelHit: 'tag' });
  expect(tool.selectHit(at(15, 15), labelCtx)).toEqual({ id: 'tag', selected: false });
  tool.onPointerDown(cell(at(15, 15)), point(at(0, 0)), labelCtx);
  expect(s().annotationSelection).toEqual(['tag']);
  expect(items()).toHaveLength(1);
  expect(tool.grabAt(at(15, 15), liveCtx({ point: point(at(15, 15)), annotationLabelHit: 'tag' }))).toBe(true);
  expect(tool.selectHit(at(5, 5), liveCtx({ point: point(at(5, 5)), annotationLabelHit: null }))).toBeNull();
  expect(tool.selectHit(at(5, 5), liveCtx({ point: point(at(5, 5)) }))).toEqual({ id: 'tag', selected: true });
});


describe('draft gesture history', () => {
  it('undoes and redoes whole paint and erase strokes before Done', () => {
    s().initMap(makeTemplate(30, 30), createDefaultRegistry());
    s().setAnnotationTool('zone');
    s().setAnnotationZoneShape('free');
    const tool = new AnnotateTool();
    drag(tool, [6, 6], [10, 6]);
    const first = structuredClone(s().annotationDraft);
    drag(tool, [6, 14], [10, 14]);
    const second = structuredClone(s().annotationDraft);
    s().undoAnnotation(); expect(s().annotationDraft).toEqual(first);
    s().redoAnnotation(); expect(s().annotationDraft).toEqual(second);
    s().setAnnotationTool('erase');
    drag(tool, [6, 6], [10, 6]);
    expect(s().annotationDraft).not.toEqual(second);
    s().undoAnnotation(); expect(s().annotationDraft).toEqual(second);
    s().undoAnnotation(); expect(s().annotationDraft).toEqual(first);
    s().undoAnnotation(); expect(s().annotationDraft).toBeNull();
    s().redoAnnotation(); expect(s().annotationDraft).toEqual(first);
    expect(items()).toEqual([]);
  });

  it('keeps an undone stroke from resuming on the next pointer move', () => {
    s().initMap(makeTemplate(30, 30), createDefaultRegistry());
    s().setAnnotationTool('zone'); s().setAnnotationZoneShape('free');
    const tool = new AnnotateTool();
    tool.onPointerDown(cell(at(6, 6)), point(at(0, 0)), press(6, 6));
    s().undoAnnotation();
    tool.onPointerMove(cell(at(10, 6)), point(at(0, 0)), press(10, 6));
    tool.onPointerUp(cell(at(10, 6)), point(at(0, 0)), press(10, 6));
    expect(s().annotationDraft).toBeNull();
    s().redoAnnotation(); expect(s().annotationDraft?.kind).toBe('zone');
  });

  it('pauses a drag while discard confirmation is pending', () => {
    s().initMap(makeTemplate(30, 30), createDefaultRegistry());
    s().setAnnotationTool('zone'); s().setAnnotationZoneShape('free');
    const tool = new AnnotateTool();
    tool.onPointerDown(cell(at(6, 6)), point(at(0, 0)), press(6, 6));
    const draft = structuredClone(s().annotationDraft);
    s().setAnnotationTool('route');
    tool.onPointerMove(cell(at(15, 6)), point(at(0, 0)), press(15, 6));
    tool.onPointerUp(cell(at(15, 6)), point(at(0, 0)), press(15, 6));
    s().cancelAnnotationDiscard();
    expect(s().annotationDraft).toEqual(draft);
    expect(s().annotationTool).toBe('zone');
  });
});

describe('the road brush unit', () => {
  /** A template large enough that its ink scale is well above 1, so no size reads it. */
  const BIG = 160;
  /** A press at the centre of cell (x, y). */
  const sized = (x: number, y: number, brushSize: number) => liveCtx({ point: point(at(...mid(x, y))), brushSize });
  const keys = (cells: readonly MacroCoord[]) => [...new Set(cells.map((c) => `${c.x},${c.y}`))].sort();
  const draftCells = () => (s().annotationDraft as ZoneNote).cells;
  const dragAt = (tool: AnnotateTool, size: number, ...pts: Array<[number, number]>) => {
    tool.onPointerDown(cell(at(pts[0]![0], pts[0]![1])), point(at(0, 0)), sized(...pts[0]!, size));
    for (const p of pts.slice(1)) tool.onPointerMove(cell(at(p[0], p[1])), point(at(0, 0)), sized(...p, size));
    const end = pts[pts.length - 1]!;
    tool.onPointerUp(cell(at(end[0], end[1])), point(at(0, 0)), sized(...end, size));
  };

  beforeEach(() => {
    __resetCurveSession();
    s().initMap(makeTemplate(BIG, BIG), createDefaultRegistry());
    useEditorStore.setState({ annotationTool: 'zone', annotationZoneShape: 'free', annotationDraft: null, annotationDiscardAction: null, eraserShape: 'free' });
    expect(annotationInkScale(s().gridState!.template)).toBeGreaterThan(4);
  });

  it.each([1, 2, 3])('a size-%i tap covers the road brush footprint on a large map', (size) => {
    new AnnotateTool().onPointerDown(cell(at(40, 40)), point(at(0, 0)), sized(40, 40, size));
    expect(keys(draftCells())).toEqual(keys(brushCells(40, 40, size)));
  });

  it('a size-1 tap covers the whole cell centred on the half-cell point nearest the pointer', () => {
    new AnnotateTool().onPointerDown(cell(at(40, 39)), point(at(0, 0)), liveCtx({ point: point(at(40.2, 39.8)), brushSize: 1 }));
    // (40, 40) is the nearest half-cell point, so the dab covers [39.5, 40.5) on both axes.
    expect(s().annotationDraft).toMatchObject({ grid: 'half' });
    expect(keys(draftCells())).toEqual(keys(rect(79, 79, 80, 80)));
  });

  it('the free brush lays one continuous road-width run, however far a pointer sample jumps', () => {
    dragAt(new AnnotateTool(), 1, [30, 50], [42, 50], [42, 56]);
    expect(keys(draftCells())).toEqual(keys([...line4(30, 50, 42, 50), ...line4(42, 50, 42, 56)]));
  });

  it('the line lays the road line from press to release', () => {
    s().setAnnotationZoneShape('line');
    dragAt(new AnnotateTool(), 1, [30, 50], [40, 54]);
    expect(keys(draftCells())).toEqual(keys(dragShapeCells('line', at(30, 50), at(40, 54), 1)));
    expect(draftCells()).toHaveLength(line4(30, 50, 40, 54).length);
  });

  it('the curve lays the road curve through its anchors', () => {
    s().setAnnotationZoneShape('curve');
    const tool = new AnnotateTool();
    for (const [x, y] of [[30, 50], [40, 44], [52, 50]] as const) tool.onPointerDown(cell(at(x, y)), point(at(0, 0)), sized(x, y, 1));
    expect(keys(draftCells())).toEqual(keys(splineCells([at(30, 50), at(40, 44), at(52, 50)], 1)));
  });
});

describe('the eraser shapes', () => {
  /** A press at the centre of cell (x, y). */
  const sized = (x: number, y: number) => liveCtx({ point: point(at(...mid(x, y))), brushSize: 1 });
  const left = () => new Set(zoneById('z1').cells.map((c) => `${c.x},${c.y}`));
  const gone = (cells: readonly MacroCoord[]) => {
    const kept = left();
    return cells.every((c) => !kept.has(`${c.x},${c.y}`));
  };

  beforeEach(() => {
    __resetCurveSession();
    s().initMap(makeTemplate(40, 40), createDefaultRegistry());
    s().setAnnotationTool('erase');
    s().addAnnotation(zone('z1', rect(2, 2, 30, 20)));
  });

  it('the free eraser takes a continuous road-width run', () => {
    s().setEraserShape('free');
    const tool = new AnnotateTool();
    tool.onPointerDown(cell(at(4, 10)), point(at(0, 0)), sized(4, 10));
    tool.onPointerMove(cell(at(20, 10)), point(at(0, 0)), sized(20, 10));
    tool.onPointerUp(cell(at(20, 10)), point(at(0, 0)), sized(20, 10));
    expect(gone(line4(4, 10, 20, 10))).toBe(true);
    expect(left().size).toBe(29 * 19 - 17);
  });

  it.each(['line', 'rect', 'circle'] as const)('the %s eraser previews while dragging and takes its figure on release', (shape) => {
    s().setEraserShape(shape);
    const tool = new AnnotateTool();
    const lanes = s().annotationUndoLane.length;
    tool.onPointerDown(cell(at(6, 6)), point(at(0, 0)), sized(6, 6));
    const move = sized(14, 12);
    const show = vi.spyOn(move.overlay, 'showGhost');
    tool.onPointerMove(cell(at(14, 12)), point(at(0, 0)), move);
    const figure = dragShapeCells(shape, at(6, 6), at(14, 12), 1);
    expect(show.mock.calls[show.mock.calls.length - 1]![0].cells).toEqual(figure);
    expect(left().size).toBe(29 * 19);
    tool.onPointerUp(cell(at(14, 12)), point(at(0, 0)), sized(14, 12));
    expect(gone(figure)).toBe(true);
    const inside = figure.filter((c) => c.x >= 2 && c.x <= 30 && c.y >= 2 && c.y <= 20);
    expect(left().size).toBe(29 * 19 - inside.length);
    expect(s().annotationUndoLane.length).toBe(lanes + 1);
  });

  it('the curve eraser collects anchors and takes the band when the last one is pressed again', () => {
    s().setEraserShape('curve');
    const tool = new AnnotateTool();
    for (const [x, y] of [[4, 16], [14, 6], [26, 16]] as const) {
      tool.onPointerDown(cell(at(x, y)), point(at(0, 0)), sized(x, y));
      tool.onPointerUp(cell(at(x, y)), point(at(0, 0)), sized(x, y));
    }
    expect(tool.hasPending(liveCtx())).toBe(true);
    expect(left().size).toBe(29 * 19);
    tool.onPointerDown(cell(at(26, 16)), point(at(0, 0)), sized(26, 16));
    const band = splineCells([at(4, 16), at(14, 6), at(26, 16)], 1);
    expect(gone(band)).toBe(true);
    expect(left().size).toBe(29 * 19 - new Set(band.map((c) => `${c.x},${c.y}`)).size);
    expect(tool.hasPending(liveCtx())).toBe(false);
  });

  it('the curve eraser takes back its last anchor before anything is erased', () => {
    s().setEraserShape('curve');
    const tool = new AnnotateTool();
    tool.onPointerDown(cell(at(4, 16)), point(at(0, 0)), sized(4, 16));
    expect(tool.undoPendingStep(liveCtx())).toBe(true);
    expect(tool.hasPending(liveCtx())).toBe(false);
    expect(left().size).toBe(29 * 19);
  });
});

describe('a zone with no text', () => {
  beforeEach(() => {
    __resetCurveSession();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    useEditorStore.setState({ annotationTool: 'zone', annotationZoneShape: 'free', annotationDraft: null, annotationDiscardAction: null, annotationSelection: [] });
  });

  it('is still selected and grown by a press on its cells, with no caption to hit', () => {
    s().addAnnotation({ ...zone('z1', rect(4, 4, 9, 8)), size: 'none' });
    const tool = new AnnotateTool();
    tool.onPointerDown(cell(at(6, 6)), point(at(0, 0)), press(6.2, 6.2));
    tool.onPointerUp(cell(at(6, 6)), point(at(0, 0)), press(6.2, 6.2));
    expect(s().annotationSelection).toEqual(['z1']);
    tool.onPointerDown(cell(at(9, 6)), point(at(0, 0)), press(...mid(9, 6)));
    tool.onPointerMove(cell(at(13, 6)), point(at(0, 0)), press(...mid(13, 6)));
    tool.onPointerUp(cell(at(13, 6)), point(at(0, 0)), press(...mid(13, 6)));
    expect(zoneById('z1').cells.some((c) => c.x === 13 && c.y === 6)).toBe(true);
    expect(zoneById('z1').size).toBe('none');
  });

  it('arms new zones with no text and keeps chips at their own lettering', () => {
    s().setAnnotationSize('none');
    const tool = new AnnotateTool();
    tool.onPointerDown(cell(at(3, 3)), point(at(0, 0)), press(3, 3));
    tool.onPointerUp(cell(at(3, 3)), point(at(0, 0)), press(3, 3));
    expect((s().annotationDraft as ZoneNote).size).toBe('none');
    s().commitAnnotationDraft();
    s().setAnnotationTool('chip');
    tool.onPointerDown(cell(at(15, 15)), point(at(0, 0)), liveCtx({ point: point(at(15, 15)), annotationTool: 'chip' }));
    const chip = items().find((n) => n.kind === 'chip') as ChipNote;
    expect(chip.size).toBe('m');
  });
});

describe('a dragged route', () => {
  const frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    __resetCurveSession();
    s().initMap(makeTemplate(40, 40), createDefaultRegistry());
    useEditorStore.setState({ annotationTool: 'route', annotationDraft: null, annotationDiscardAction: null, annotationSelection: [] });
    frames.length = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => { frames.length = 0; });
  });
  afterEach(() => vi.unstubAllGlobals());

  const at24 = (x: number, y: number) => liveCtx({ point: point(at(x, y)), cellPixels: 24 });

  it('draws one fit per frame, and keeps on release exactly the route the last frame drew', () => {
    const tool = new AnnotateTool();
    tool.onPointerDown(cell(at(4, 4)), point(at(0, 0)), at24(4.1, 4.2));
    let live: MacroCoord[] = [];
    for (let i = 1; i <= 60; i++) {
      const x = 4.1 + i * 0.3, y = 4.2 + (i > 30 ? (i - 30) * 0.3 : 0) + (i % 2 ? 0.05 : -0.05);
      tool.onPointerMove(cell(at(Math.floor(x), Math.floor(y))), point(at(0, 0)), at24(x, y));
      tool.onPointerMove(cell(at(Math.floor(x), Math.floor(y))), point(at(0, 0)), at24(x + 0.02, y));
      expect(frames.length).toBeLessThanOrEqual(1);
      while (frames.length) frames.shift()!(0);
      live = (s().annotationDraft as RouteNote).points.map((p) => ({ x: p.x, y: p.y }));
    }
    const end = { x: 4.1 + 60 * 0.3, y: 4.2 + 30 * 0.3 - 0.05 };
    tool.onPointerUp(cell(at(Math.floor(end.x), Math.floor(end.y))), point(at(0, 0)), at24(end.x + 0.02, end.y));
    const route = items().find((n) => n.kind === 'route') as RouteNote;
    expect(route.points.map((p) => ({ x: p.x, y: p.y }))).toEqual(live);
    // One straight run and one turn: the wobble between samples adds no anchors.
    expect(route.points.length).toBeLessThanOrEqual(4);
  });
});

describe('route width', () => {
  beforeEach(() => {
    __resetCurveSession();
    s().initMap(makeTemplate(40, 40), createDefaultRegistry());
    useEditorStore.setState({ annotationTool: 'route', annotationDraft: null, annotationDiscardAction: null, annotationSelection: [], annotationRouteWidth: 1 });
  });

  it('gives a new route the slider width and keeps it on that route alone', () => {
    s().setAnnotationRouteWidth(3);
    const tool = new AnnotateTool();
    drag(tool, [4, 4], [20, 12]);
    const first = items().find((n) => n.kind === 'route') as RouteNote;
    expect(first.width).toBe(3);
    __resetCurveSession(); s().setAnnotationSelection([]);
    s().setAnnotationRouteWidth(1);
    drag(tool, [4, 30], [20, 34]);
    const routes = items().filter((n): n is RouteNote => n.kind === 'route');
    expect(routes.map((r) => r.width)).toEqual([3, 1]);
  });

  it('moving the slider re-widths the selected route and leaves the brush size alone', () => {
    s().addAnnotation({ kind: 'route', id: 'r', points: [at(2, 2), at(9, 2)], color: '#FFB347', dashed: false });
    s().setAnnotationSelection(['r']);
    const brush = brushSizeOf(s());
    s().setAnnotationRouteWidth(5);
    expect((items()[0] as RouteNote).width).toBe(5);
    expect(brushSizeOf(s())).toBe(brush);
  });
});

describe('half-cell steps', () => {
  let tool: AnnotateTool;
  const draft = () => s().annotationDraft as ZoneNote;
  const area = (z: ZoneNote) => z.cells.length * (z.grid ? 0.25 : 1);
  /** A size-1 brush press at map point (x, y). */
  const one = (x: number, y: number) => liveCtx({ point: point(at(x, y)), brushSize: 1 });
  const click = (_tool: AnnotateTool, x: number, y: number): void => {
    tool.onPointerDown(cell(at(Math.floor(x), Math.floor(y))), point(at(0, 0)), one(x, y));
    tool.onPointerUp(cell(at(Math.floor(x), Math.floor(y))), point(at(0, 0)), one(x, y));
  };
  const drag = (_tool: AnnotateTool, from: [number, number], to: [number, number]): void => {
    tool.onPointerDown(cell(at(Math.floor(from[0]), Math.floor(from[1]))), point(at(0, 0)), one(...from));
    tool.onPointerMove(cell(at(Math.floor(to[0]), Math.floor(to[1]))), point(at(0, 0)), one(...to));
    tool.onPointerUp(cell(at(Math.floor(to[0]), Math.floor(to[1]))), point(at(0, 0)), one(...to));
  };

  beforeEach(() => {
    tool = new AnnotateTool();
    multiHeld = false;
    __resetCurveSession();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    useEditorStore.setState({ annotationZoneShape: 'free', eraserShape: 'free', annotationDraft: null, annotationSelection: [] });
  });

  it('a zone tap at a cell corner lays a whole-cell dab centred there, on the half grid', () => {
    s().setAnnotationTool('zone');
    click(tool, 5, 5);
    expect(draft().grid).toBe('half');
    expect(cellEdges(draft().cells, 'half')).toEqual({ left: 4.5, top: 4.5, right: 5.5, bottom: 5.5 });
    expect(area(draft())).toBe(1);
  });

  it('a zone tap at a cell centre lays that whole cell, stored without a grid', () => {
    s().setAnnotationTool('zone');
    click(tool, ...mid(5, 5));
    expect(draft()).not.toHaveProperty('grid');
    expect(draft().cells).toEqual([at(5, 5)]);
  });

  it('a free zone stroke runs in half-cell steps between its samples', () => {
    s().setAnnotationTool('zone');
    drag(tool, [5, 5], [9, 5]);
    expect(draft().grid).toBe('half');
    expect(cellEdges(draft().cells, 'half')).toEqual({ left: 4.5, top: 4.5, right: 9.5, bottom: 5.5 });
    expect(area(draft())).toBe(5);
  });

  it('a move that stays on the step already laid writes nothing, so the re-sample it causes settles', () => {
    s().setAnnotationTool('zone');
    tool.onPointerDown(cell(at(5, 5)), point(at(0, 0)), one(5, 5));
    tool.onPointerMove(cell(at(7, 5)), point(at(0, 0)), one(7, 5));
    const written = s().annotationDraft;
    tool.onPointerMove(cell(at(7, 5)), point(at(0, 0)), one(7.1, 5.1));
    expect(s().annotationDraft).toBe(written);
    tool.onPointerMove(cell(at(7, 5)), point(at(0, 0)), one(7.4, 5));
    expect(s().annotationDraft).not.toBe(written);
  });

  it('a zone rectangle reaches from half-cell corner to half-cell corner', () => {
    s().setAnnotationTool('zone');
    s().setAnnotationZoneShape('rect');
    drag(tool, [2, 2], [5, 4]);
    expect(cellEdges(draft().cells, 'half')).toEqual({ left: 1.5, top: 1.5, right: 5.5, bottom: 4.5 });
    expect(area(draft())).toBe(4 * 3);
  });

  it('a zone line at a half-cell row lays a band half a cell off the whole-cell rows', () => {
    s().setAnnotationTool('zone');
    s().setAnnotationZoneShape('line');
    drag(tool, [2.5, 3], [8.5, 3]);
    expect(cellEdges(draft().cells, 'half')).toEqual({ left: 2, top: 2.5, right: 9, bottom: 3.5 });
  });

  it('a stroke grows a whole-cell zone in half-cell steps, and the eraser takes half-cell bites', () => {
    s().addAnnotation(zone('z1', rect(4, 4, 6, 6)));
    s().setAnnotationTool('zone');
    drag(tool, [5.5, 5.5], [7.9, 5.5]);
    expect(zoneById('z1').grid).toBe('half');
    expect(cellEdges(zoneById('z1').cells, 'half')!.right).toBe(8.5);
    s().setAnnotationTool('erase');
    click(tool, 4, 4);
    // The bite is the whole cell centred on the corner (4, 4): a quarter of it lay on the zone.
    expect(area(zoneById('z1'))).toBe(9 + 1.5 - 0.25);
    expect(zoneHit(4.2, 4.2)).toBeNull();
    expect(zoneHit(4.7, 4.2)?.id).toBe('z1');
  });

  it('moving a zone takes half-cell steps, and a whole-cell move back restores its stored form', () => {
    s().addAnnotation(zone('z1', [at(4, 8), at(5, 8)]));
    s().setAnnotationTool('none');
    s().setAnnotationSelection(['z1']);
    drag(tool, [4.5, 8.5], [5.1, 8.4]);
    expect(zoneById('z1').grid).toBe('half');
    expect(cellEdges(zoneById('z1').cells, 'half')).toEqual({ left: 4.5, top: 8, right: 6.5, bottom: 9 });
    drag(tool, [5.1, 8.4], [4.5, 8.5]);
    expect(zoneById('z1')).toEqual(zone('z1', [at(4, 8), at(5, 8)]));
  });

  it('a press on a half-grid zone hits only its own half cells, in the select state', () => {
    // One half cell, [4.5, 5) on both axes, with no caption to hit.
    s().addAnnotation({ ...zone('z1', [at(9, 9)]), grid: 'half', size: 'none' });
    s().setAnnotationTool('none');
    click(tool, 5.2, 5.2);
    expect(s().annotationSelection).toEqual([]);
    click(tool, 4.7, 4.7);
    expect(s().annotationSelection).toEqual(['z1']);
  });

  it('route waypoints land on the half-cell lattice', () => {
    s().setAnnotationTool('route');
    click(tool, 3.3, 4.2);
    click(tool, 8.6, 4.9);
    click(tool, 8.6, 4.9);
    expect((items()[0] as RouteNote).points).toEqual([at(3.5, 4), at(8.5, 5)]);
  });

  it('a dragged route keeps every anchor on the half-cell lattice', () => {
    s().setAnnotationTool('route');
    tool.onPointerDown(cell(at(2, 2)), point(at(0, 0)), one(2.3, 2.1));
    for (let x = 3; x <= 10; x++) tool.onPointerMove(cell(at(x, 2)), point(at(0, 0)), one(x + 0.3, 2.1));
    for (let y = 3; y <= 8; y++) tool.onPointerMove(cell(at(10, y)), point(at(0, 0)), one(10.3, y + 0.1));
    tool.onPointerUp(cell(at(10, 8)), point(at(0, 0)), one(10.3, 8.1));
    const route = items()[0] as RouteNote;
    expect(route.points[0]).toEqual(at(2.5, 2));
    expect(route.points[route.points.length - 1]).toEqual(at(10.5, 8));
    for (const p of route.points) expect([p.x * 2, p.y * 2].every(Number.isInteger)).toBe(true);
  });

  it('a route moves in half-cell steps', () => {
    s().addAnnotation({ kind: 'route', id: 'r1', points: [at(2, 10), at(12, 10)], color: '#38BDF8', dashed: true });
    s().setAnnotationTool('none');
    s().setAnnotationSelection(['r1']);
    drag(tool, [7, 10], [8.3, 10.2]);
    expect((items()[0] as RouteNote).points).toEqual([at(3.5, 10), at(13.5, 10)]);
  });

  it('measurement ends land on cells cornered on the half-cell lattice and count half cells', () => {
    s().setAnnotationTool('measure');
    click(tool, 3, 5.2);
    click(tool, 9.6, 5.2);
    const m = items()[0] as MeasureNote;
    expect(m.points).toEqual([at(2.5, 4.5), at(9, 4.5)]);
    expect(measureDrawing(m.points, 1).labels[0]!.value).toBe(7.5);
  });

  it('a dragged measurement ends half a cell over, and moves in half-cell steps', () => {
    s().setAnnotationTool('measure');
    drag(tool, mid(3, 5), [12.1, 5.5]);
    const m = items()[0] as MeasureNote;
    expect(m.points).toEqual([at(3, 5), at(11.5, 5)]);
    s().setAnnotationTool('none');
    click(tool, 6, 5);
    drag(tool, [6, 5], [6.6, 5]);
    expect((items()[0] as MeasureNote).points).toEqual([at(3.5, 5), at(12, 5)]);
  });
});

/** The zone a select-state press at (x, y) lands on. */
function zoneHit(x: number, y: number): ZoneNote | null {
  const hit = new AnnotateTool().selectHit(at(Math.floor(x), Math.floor(y)), liveCtx({ point: point(at(x, y)), annotationTool: 'none' }));
  return hit ? zoneById(hit.id) : null;
}

describe('note ghosts', () => {
  let tool: AnnotateTool;

  beforeEach(() => {
    multiHeld = false;
    tool = new AnnotateTool();
    __resetCurveSession();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    useEditorStore.setState({ annotationDraft: null, annotationDiscardAction: null, annotationSelection: [] });
  });

  /** A hover at the exact map point (x, y): the note ghost it shows, else null; asserts it laid nothing. */
  function hover(x: number, y: number): { note: MapAnnotation; label: string } | null {
    const ctx = press(x, y);
    const show = vi.spyOn(ctx.overlay, 'showNoteGhost');
    const draft = s().annotationDraft;
    const count = items().length;
    tool.onPointerMove(cell(at(Math.floor(x), Math.floor(y))), point(at(x, y)), ctx);
    expect(s().annotationDraft).toBe(draft);
    expect(items()).toHaveLength(count);
    const last = show.mock.calls[show.mock.calls.length - 1];
    return last ? { note: last[0], label: last[1] } : null;
  }

  it('measure shows the first end on its half-cell step, the cell the press then lays', () => {
    s().setAnnotationTool('measure');
    const ghost = hover(3.3, 5.2)!.note as MeasureNote;
    expect(ghost.kind).toBe('measure');
    expect(ghost.points).toEqual([at(3, 4.5), at(3, 4.5)]);
    expect(ghost.color).toBe(s().annotationColor);
    tool.onPointerDown(cell(at(3, 5)), point(at(3.3, 5.2)), press(3.3, 5.2));
    tool.onPointerUp(cell(at(3, 5)), point(at(3.3, 5.2)), press(3.3, 5.2));
    expect((s().annotationDraft as MeasureNote).points).toEqual(ghost.points);
  });

  it('measure gives way to the open draft, whose far end follows the pointer', () => {
    s().setAnnotationTool('measure');
    click(tool, 3.3, 5.2);
    const ctx = press(9.6, 5.4);
    const show = vi.spyOn(ctx.overlay, 'showNoteGhost');
    tool.onPointerMove(cell(at(9, 5)), point(at(9.6, 5.4)), ctx);
    expect(show).not.toHaveBeenCalled();
    expect((s().annotationDraft as MeasureNote).points).toEqual([at(3, 4.5), at(9, 4.5)]);
  });

  it('route shows its first point on the half-cell lattice, then the waypoint route with the next point', () => {
    s().setAnnotationTool('route');
    s().setAnnotationRouteDashed(true);
    const first = hover(3.3, 4.2)!.note as RouteNote;
    expect(first).toMatchObject({ kind: 'route', points: [at(3.5, 4)], dashed: true, color: s().annotationColor });
    click(tool, 3.3, 4.2);
    expect((s().annotationDraft as RouteNote).points).toEqual(first.points);
    const next = hover(8.6, 4.9)!.note as RouteNote;
    expect(next.points).toEqual([at(3.5, 4), at(8.5, 5)]);
    click(tool, 8.6, 4.9);
    expect((s().annotationDraft as RouteNote).points).toEqual(next.points);
  });

  it('route shows nothing where the press would end the route or select one', () => {
    s().setAnnotationTool('route');
    click(tool, 3.3, 4.2);
    expect(hover(3.5, 4)).toBeNull();
    s().setAnnotationDraft(null);
    s().addAnnotation({ kind: 'route', id: 'r1', points: [at(2, 10), at(12, 10)], color: '#38BDF8', dashed: false });
    expect(hover(7, 10)).toBeNull();
  });

  it('route shows nothing while a drag draws', () => {
    s().setAnnotationTool('route');
    tool.onPointerDown(cell(at(2, 2)), point(at(2.3, 2.1)), press(2.3, 2.1));
    const ctx = press(6.3, 2.1);
    const show = vi.spyOn(ctx.overlay, 'showNoteGhost');
    tool.onPointerMove(cell(at(6, 2)), point(at(6.3, 2.1)), ctx);
    expect(show).not.toHaveBeenCalled();
  });

  it('chip shows the armed plate where the press drops it, with its label', () => {
    s().setAnnotationTool('chip');
    s().setAnnotationTag('landmark');
    s().setAnnotationSize('l');
    const ghost = hover(5.3, 6.7)!;
    expect(ghost.note).toMatchObject({ kind: 'chip', tag: 'landmark', size: 'l', x: 5.3, y: 6.7 });
    expect(ghost.label).toBe('landmark');
    click(tool, 5.3, 6.7);
    const { id: _ghostId, ...plate } = ghost.note as ChipNote;
    const { id: _id, ...dropped } = items()[0] as ChipNote;
    expect(dropped).toEqual(plate);
  });

  it('chip shows nothing over a plate the press would select, or with no tag armed', () => {
    s().setAnnotationTool('chip');
    s().addAnnotation({ kind: 'chip', id: 'tag', x: 6, y: 6, tag: 'plaza', size: 'm', color: '#FFB347' });
    expect(hover(6, 6.2)).toBeNull();
    s().setAnnotationTag(null);
    expect(hover(15, 15)).toBeNull();
  });

  it('takes the ghost down on a hidden or locked layer, and on a press', () => {
    s().setAnnotationTool('measure');
    s().setAnnotationsLocked(true);
    const ctx = press(4, 4);
    const clear = vi.spyOn(ctx.overlay, 'clearGhost');
    expect(hover(4, 4)).toBeNull();
    s().setAnnotationsLocked(false);
    s().setAnnotationsVisible(false);
    expect(hover(4, 4)).toBeNull();
    s().setAnnotationsVisible(true);
    expect(hover(4, 4)).not.toBeNull();
    tool.onPointerDown(cell(at(4, 4)), point(at(4, 4)), ctx);
    expect(clear).toHaveBeenCalled();
  });
});
