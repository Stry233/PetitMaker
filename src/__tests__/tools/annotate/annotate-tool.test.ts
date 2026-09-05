/**
 * The plan-notes tool, driven through a scripted ToolContext over the live store — the same
 * refresh-per-event shape ToolManager gives it. Cell coordinates only, so what passes here holds
 * in both views by construction.
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
import type { EditorEvents } from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';
import { makeToolCtx } from '../_tool-ctx';
import type { ToolContext } from '../../../tools/runtime/types';
import type { RouteNote, ZoneNote } from '../../../core/model/annotations';
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
    annotationTextStyle: s().annotationTextStyle,
    annotationTextSize: s().annotationTextSize,
    annotationRouteDashed: s().annotationRouteDashed,
    annotationSelection: s().annotationSelection,
    annotationDraft: s().annotationDraft,
    annotationEdit: {
      begin: () => s().beginAnnotationStroke(),
      apply: (fn) => s().applyAnnotationEdit(fn),
      add: (a) => s().addAnnotation(a),
      remove: (id) => s().removeAnnotation(id),
      select: (id) => s().setAnnotationSelection(id),
      setDraft: (a) => s().setAnnotationDraft(a),
      setNaming: (id) => s().setAnnotationNaming(id),
    },
    ...over,
  });
}

const at = (x: number, y: number) => ({ x, y });

describe('AnnotateTool', () => {
  let tool: AnnotateTool;

  beforeEach(() => {
    tool = new AnnotateTool();
    multiHeld = false;
    __resetCurveSession();
    useEditorStore.getState().initMap(makeTemplate(20, 20), createDefaultRegistry());
  });

  it('a zone paints as a draft and commits named-ready on release', () => {
    s().setAnnotationTool('zone');
    tool.onPointerDown(at(3, 3), at(6, 6), liveCtx());
    expect(s().annotationDraft?.kind).toBe('zone');
    tool.onPointerMove(at(6, 3), at(12, 6), liveCtx());
    tool.onPointerUp(at(6, 3), at(12, 6), liveCtx());
    const items = s().gridState?.annotations?.items ?? [];
    expect(items).toHaveLength(1);
    const zone = items[0] as ZoneNote;
    expect(zone.num).toBe(1);
    expect(zone.cells.length).toBeGreaterThan(4);
    expect(s().annotationDraft).toBeNull();
    expect(s().annotationSelection).toEqual([zone.id]);
    expect(s().annotationNaming).toBe(zone.id);
  });

  it('a route collects waypoints and a press back on the last one finishes it', () => {
    s().setAnnotationTool('route');
    tool.onPointerDown(at(2, 2), at(4, 4), liveCtx({ halfCoord: at(2.5, 2.5) }));
    tool.onPointerDown(at(8, 2), at(16, 4), liveCtx({ halfCoord: at(8.5, 2.5) }));
    tool.onPointerDown(at(8, 8), at(16, 16), liveCtx({ halfCoord: at(8.5, 8.5) }));
    expect((s().annotationDraft as RouteNote).points).toHaveLength(3);
    expect(tool.hasPending(liveCtx())).toBe(true);
    tool.onPointerDown(at(8, 8), at(16, 16), liveCtx({ halfCoord: at(8.5, 8.5) }));
    const items = s().gridState?.annotations?.items ?? [];
    expect(items).toHaveLength(1);
    expect((items[0] as RouteNote).points).toHaveLength(3);
    expect(s().annotationDraft).toBeNull();
    expect(tool.hasPending(liveCtx())).toBe(false);
  });

  it('a finished route keeps its anchors up for tuning, and one drag is one undo entry', () => {
    s().setAnnotationTool('route');
    tool.onPointerDown(at(2, 2), at(4, 4), liveCtx());
    tool.onPointerDown(at(8, 2), at(16, 4), liveCtx());
    tool.onPointerDown(at(8, 2), at(16, 4), liveCtx());
    expect(isCurveSessionOpen()).toBe(true);
    const lanes = s().annotationUndoLane.length;
    moveCurveAnchor(1, 8.5, 6.5, false);
    moveCurveAnchor(1, 9.5, 8.5, true);
    const route = (s().gridState?.annotations?.items ?? [])[0] as RouteNote;
    expect(route.points[1]).toMatchObject({ x: 9.5, y: 8.5 });
    expect(s().annotationUndoLane.length).toBe(lanes + 1);
    // The next map press is dismiss-only: handles down, selection down, nothing minted.
    tool.onPointerDown(at(12, 12), at(24, 24), liveCtx());
    expect(isCurveSessionOpen()).toBe(false);
    expect(s().annotationDraft).toBeNull();
    expect((s().gridState?.annotations?.items ?? [])).toHaveLength(1);
  });

  it('a bar press that clears the draft clears the pending answer with it', () => {
    s().setAnnotationTool('route');
    tool.onPointerDown(at(2, 2), at(4, 4), liveCtx());
    expect(tool.hasPending(liveCtx())).toBe(true);
    // The bar writes the store directly; the tool instance hears nothing, so the answer must be
    // read off the store's own draft rather than mirrored.
    s().setAnnotationTool('zone');
    expect(s().annotationDraft).toBeNull();
    expect(tool.hasPending(liveCtx())).toBe(false);
  });

  it('escape abandons a route draft and delete takes back its last waypoint', () => {
    s().setAnnotationTool('route');
    tool.onPointerDown(at(2, 2), at(4, 4), liveCtx());
    tool.onPointerDown(at(6, 2), at(12, 4), liveCtx());
    expect(tool.undoPendingStep(liveCtx())).toBe(true);
    expect((s().annotationDraft as RouteNote).points).toHaveLength(1);
    expect(tool.cancelPending(liveCtx())).toBe(true);
    expect(s().annotationDraft).toBeNull();
  });

  it('with nothing armed a press selects and a drag moves, as one undo entry', () => {
    s().addAnnotation({ kind: 'text', id: 't1', x: 5.5, y: 5.5, text: '广场', style: 'chip', size: 'm', color: '#FFB347' });
    s().setAnnotationTool('none');
    tool.onPointerDown(at(5, 5), at(10, 10), liveCtx({ halfCoord: at(5.5, 5.5) }));
    expect(s().annotationSelection).toEqual(['t1']);
    tool.onPointerMove(at(8, 5), at(16, 10), liveCtx({ halfCoord: at(8.5, 5.5) }));
    tool.onPointerMove(at(9, 5), at(18, 10), liveCtx({ halfCoord: at(9.5, 5.5) }));
    tool.onPointerUp(at(9, 5), at(18, 10), liveCtx());
    const moved = s().gridState!.annotations!.items[0]!;
    expect(moved.kind === 'text' && moved.x).toBe(9.5);
    expect(s().undoAnnotation()).toBe(true);
    const back = s().gridState!.annotations!.items[0]!;
    expect(back.kind === 'text' && back.x).toBe(5.5);
    expect(s().undoAnnotation()).toBe(true);
    expect(s().undoAnnotation()).toBe(false);
  });

  it('the eraser removes what it hits, topmost first', () => {
    s().addAnnotation({ kind: 'zone', id: 'z1', cells: [at(4, 4), at(5, 4)], color: '#2FBF9B', name: '', num: 1 });
    s().addAnnotation({ kind: 'text', id: 't1', x: 4.5, y: 4.5, text: '果园', style: 'label', size: 'm', color: '#FFFEE3' });
    s().setAnnotationTool('erase');
    tool.onPointerDown(at(4, 4), at(8, 8), liveCtx({ halfCoord: at(4.5, 4.5) }));
    const ids = (s().gridState?.annotations?.items ?? []).map((n) => n.id);
    expect(ids).toEqual(['z1']);
  });

  it('a hidden or locked layer refuses edits but not selection', () => {
    s().addAnnotation({ kind: 'zone', id: 'z1', cells: [at(4, 4)], color: '#2FBF9B', name: '', num: 1 });
    s().setAnnotationsLocked(true);
    s().setAnnotationTool('zone');
    tool.onPointerDown(at(8, 8), at(16, 16), liveCtx());
    expect(s().annotationDraft).toBeNull();
    expect(s().gridState?.annotations?.items).toHaveLength(1);
    s().setAnnotationTool('none');
    // Zone cell (4,4) draws over [3.5, 4.5), so its drawn centre is the press that hits it.
    tool.onPointerDown(at(4, 4), at(8, 8), liveCtx({ halfCoord: at(4, 4) }));
    expect(s().annotationSelection).toEqual(['z1']);
    tool.onPointerMove(at(9, 4), at(18, 8), liveCtx({ halfCoord: at(9, 4) }));
    expect((s().gridState!.annotations!.items[0] as ZoneNote).cells[0]).toEqual(at(4, 4));
  });
});

describe('the zone figures', () => {
  beforeEach(() => {
    useEditorStore.getState().initMap(makeTemplate(20, 20), createDefaultRegistry());
  });

  it('a rectangle drags out and commits filled', () => {
    const tool = new AnnotateTool();
    s().setAnnotationTool('zone');
    s().setAnnotationZoneShape('rect');
    tool.onPointerDown(at(2, 2), at(4, 4), liveCtx());
    tool.onPointerMove(at(5, 4), at(10, 8), liveCtx());
    tool.onPointerUp(at(5, 4), at(10, 8), liveCtx());
    const zone = s().gridState!.annotations!.items[0] as ZoneNote;
    expect(zone.cells).toHaveLength(4 * 3);
  });

  it('a line lays a band along the drag', () => {
    const tool = new AnnotateTool();
    s().setAnnotationTool('zone');
    s().setAnnotationZoneShape('line');
    tool.onPointerDown(at(2, 2), at(4, 4), liveCtx({ halfCoord: at(2, 2) }));
    tool.onPointerMove(at(8, 2), at(16, 4), liveCtx({ halfCoord: at(8, 2) }));
    tool.onPointerUp(at(8, 2), at(16, 4), liveCtx({ halfCoord: at(8, 2) }));
    const zone = s().gridState!.annotations!.items[0] as ZoneNote;
    expect(zone.cells.length).toBeGreaterThan(6);
    expect(zone.cells.some((c) => c.x === 2 && c.y === 2)).toBe(true);
    expect(zone.cells.some((c) => c.x === 8 && c.y === 2)).toBe(true);
  });

  it('a curve collects anchors and a press back on the last one takes the band', () => {
    const tool = new AnnotateTool();
    s().setAnnotationTool('zone');
    s().setAnnotationZoneShape('curve');
    tool.onPointerDown(at(2, 2), at(4, 4), liveCtx());
    tool.onPointerDown(at(8, 3), at(16, 6), liveCtx());
    tool.onPointerDown(at(12, 8), at(24, 16), liveCtx());
    expect(tool.hasPending(liveCtx())).toBe(true);
    tool.onPointerDown(at(12, 8), at(24, 16), liveCtx());
    const zone = s().gridState!.annotations!.items[0] as ZoneNote;
    expect(zone.cells.length).toBeGreaterThan(10);
    expect(tool.hasPending(liveCtx())).toBe(false);
    expect(s().annotationNaming).toBe(zone.id);
  });

  it('the figure survives a put-away, the terrain shape rule', () => {
    s().setAnnotationZoneShape('circle');
    s().setAnnotationTool('none');
    s().setAnnotationTool('zone');
    expect(s().annotationZoneShape).toBe('circle');
  });
});

describe('dismiss-first while a note stands selected', () => {
  beforeEach(() => {
    useEditorStore.getState().initMap(makeTemplate(20, 20), createDefaultRegistry());
  });

  it('a drawing press puts the selection away and makes nothing; the next press draws', () => {
    const tool = new AnnotateTool();
    s().addAnnotation({ kind: 'text', id: 't1', x: 5, y: 5, text: '广场', style: 'chip', size: 'm', color: '#FFB347' });
    s().setAnnotationTool('zone');
    useEditorStore.setState({ annotationSelection: ['t1'] });
    tool.onPointerDown(at(10, 10), at(20, 20), liveCtx());
    expect(s().annotationSelection).toEqual([]);
    expect(s().annotationDraft).toBeNull();
    expect(s().gridState?.annotations?.items).toHaveLength(1);
    tool.onPointerDown(at(10, 10), at(20, 20), liveCtx());
    expect(s().annotationDraft?.kind).toBe('zone');
  });

  it('the select state keeps its presses: they are how the selection moves', () => {
    const tool = new AnnotateTool();
    s().addAnnotation({ kind: 'text', id: 't1', x: 5.5, y: 5.5, text: '广场', style: 'chip', size: 'm', color: '#FFB347' });
    s().setAnnotationTool('none');
    useEditorStore.setState({ annotationSelection: ['t1'] });
    tool.onPointerDown(at(5, 5), at(10, 10), liveCtx({ halfCoord: at(5.5, 5.5) }));
    expect(s().annotationSelection).toEqual(['t1']);
  });
});

describe('the selection set at the pointer', () => {
  let tool: AnnotateTool;
  const s = () => useEditorStore.getState();

  beforeEach(() => {
    tool = new AnnotateTool();
    multiHeld = false;
    __resetCurveSession();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().addAnnotation({ kind: 'zone', id: 'z1', cells: [at(4, 8), at(5, 8)], color: '#FF8A7A', name: '居住区', num: 1 } as any);
    s().addAnnotation({ kind: 'zone', id: 'z2', cells: [at(12, 8), at(13, 8)], color: '#3B82F6', name: '', num: 2 } as any);
    s().setAnnotationTool('none');
  });

  it('grabAt answers the select state only, and only over a note', () => {
    // Over z1's cells in the select state: the press would pick the note up, so the machine
    // mirrors an object drag's cursor and keeps the camera off the drag.
    expect(tool.grabAt(at(4, 8), liveCtx({ halfCoord: at(4, 8) }))).toBe(true);
    // Empty ground: the drag falls to the camera, the empty-handed pan.
    expect(tool.grabAt(at(20, 20), liveCtx({ halfCoord: at(20.5, 20.5) }))).toBe(false);
    // With a drawing tool armed the press draws; nothing is grabbed whatever it lands on.
    s().setAnnotationTool('zone');
    expect(tool.grabAt(at(4, 8), liveCtx({ halfCoord: at(4, 8) }))).toBe(false);
    s().setAnnotationTool('none');
    // A hidden layer offers nothing to grab.
    s().setAnnotationsVisible(false);
    expect(tool.grabAt(at(4, 8), liveCtx({ halfCoord: at(4, 8) }))).toBe(false);
  });

  it('selects and selectHit publish the select-state facts the modifier cursor reads', () => {
    expect(tool.selects(liveCtx())).toBe(true);
    useEditorStore.setState({ annotationSelection: ['z1'] });
    expect(tool.selectHit(at(4, 8), liveCtx({ halfCoord: at(4, 8) }))).toEqual({ id: 'z1', selected: true });
    expect(tool.selectHit(at(12, 8), liveCtx({ halfCoord: at(12, 8) }))).toEqual({ id: 'z2', selected: false });
    expect(tool.selectHit(at(20, 20), liveCtx({ halfCoord: at(20.5, 20.5) }))).toBeNull();
    // A drawing tool is not a select state; neither is a hidden layer.
    s().setAnnotationTool('zone');
    expect(tool.selects(liveCtx())).toBe(false);
    s().setAnnotationTool('none');
    s().setAnnotationsVisible(false);
    expect(tool.selects(liveCtx())).toBe(false);
  });

  it('the zone CAPTION is a grab handle: a press on the number bubble selects the zone', () => {
    // z1's caption stands at the centroid of its drawn cells, (4.5, 8) — press left of it, on the
    // bubble, which is OUTSIDE the zone's own cells.
    tool.onPointerDown(at(3, 8), at(6, 16), liveCtx({ halfCoord: at(3.6, 8) }));
    expect(s().annotationSelection).toEqual(['z1']);
  });

  it('ctrl toggles members in and out without arming a drag', () => {
    tool.onPointerDown(at(4, 8), at(8, 16), liveCtx({ halfCoord: at(4, 8) }));
    expect(s().annotationSelection).toEqual(['z1']);
    multiHeld = true;
    tool.onPointerDown(at(12, 8), at(24, 16), liveCtx({ halfCoord: at(12, 8) }));
    expect(s().annotationSelection).toEqual(['z1', 'z2']);
    // Toggling one back out leaves the rest standing.
    tool.onPointerDown(at(4, 8), at(8, 16), liveCtx({ halfCoord: at(4, 8) }));
    expect(s().annotationSelection).toEqual(['z2']);
    // A ctrl press on empty ground keeps the set.
    tool.onPointerDown(at(20, 20), at(40, 40), liveCtx({ halfCoord: at(20.5, 20.5) }));
    expect(s().annotationSelection).toEqual(['z2']);
  });

  it('a plain drag on a member moves the WHOLE set', () => {
    s().setAnnotationSelection(['z1', 'z2']);
    tool.onPointerDown(at(4, 8), at(8, 16), liveCtx({ halfCoord: at(4, 8) }));
    expect(s().annotationSelection).toEqual(['z1', 'z2']);
    tool.onPointerMove(at(6, 10), at(12, 20), liveCtx({ halfCoord: at(6, 10) }));
    tool.onPointerUp(at(6, 10), at(12, 20), liveCtx({ halfCoord: at(6, 10) }));
    const items = s().gridState!.annotations!.items as any[];
    expect(items.find((n) => n.id === 'z1').cells[0]).toEqual(at(6, 10));
    expect(items.find((n) => n.id === 'z2').cells[0]).toEqual(at(14, 10));
  });
});

describe('caption select under an armed tool', () => {
  let tool: AnnotateTool;
  const s = () => useEditorStore.getState();

  beforeEach(() => {
    tool = new AnnotateTool();
    multiHeld = false;
    __resetCurveSession();
    s().initMap(makeTemplate(24, 24), createDefaultRegistry());
    s().addAnnotation({ kind: 'zone', id: 'z1', cells: [at(4, 8), at(5, 8)], color: '#FF8A7A', name: '居住区', num: 1 } as any);
  });

  it('a brush press ON the caption selects instead of painting', () => {
    s().setAnnotationTool('zone');
    tool.onPointerDown(at(4, 8), at(8, 16), liveCtx({ halfCoord: at(4.5, 8) }));
    expect(s().annotationSelection).toEqual(['z1']);
    expect(s().annotationDraft).toBeNull();
    expect(s().gridState!.annotations!.items).toHaveLength(1);
  });

  it('a brush press OFF the caption still paints', () => {
    s().setAnnotationTool('zone');
    tool.onPointerDown(at(14, 14), at(28, 28), liveCtx({ halfCoord: at(14.5, 14.5) }));
    expect(s().annotationDraft?.kind).toBe('zone');
    expect(s().annotationSelection).toEqual([]);
  });

  it('a route mid-waypoints keeps its press: the caption does not steal a waypoint', () => {
    s().setAnnotationTool('route');
    tool.onPointerDown(at(14, 14), at(28, 28), liveCtx({ halfCoord: at(14.5, 14.5) }));
    tool.onPointerDown(at(4, 8), at(8, 16), liveCtx({ halfCoord: at(4.5, 8) }));
    const d = s().annotationDraft as any;
    expect(d?.kind).toBe('route');
    expect(d.points).toHaveLength(2);
    expect(s().annotationSelection).toEqual([]);
  });
});
