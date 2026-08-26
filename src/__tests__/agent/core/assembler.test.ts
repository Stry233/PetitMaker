import { describe, expect, it } from 'vitest';
import { createAssembler } from '../../../agent/core/assembler';

function make() { return createAssembler(); }

describe('turn assembler', () => {
  it('assembles interleaved text, reasoning and tool parts in stream order', () => {
    const a = make();
    a.push({ t: 'reasoning', delta: 'hm' });
    a.push({ t: 'text', delta: 'Placing ' });
    a.push({ t: 'tool-start', callId: 'c1', name: 'place_object' });
    a.push({ t: 'tool-args', callId: 'c1', delta: '{"id":"tree-1"' });
    a.push({ t: 'text', delta: 'a tree.' });
    a.push({ t: 'done', stop: 'tool-calls', final: [{ callId: 'c1', name: 'place_object', args: { id: 'tree-1' }, rawArgs: '{"id":"tree-1"}' }] });
    const turn = a.finish();
    expect(turn.parts.map((p) => p.kind)).toEqual(['reasoning', 'text', 'tool']);
    expect(turn.parts[1]).toMatchObject({ kind: 'text', text: 'Placing a tree.', done: true });
    expect(turn.parts[2]).toMatchObject({ kind: 'tool', callId: 'c1', input: { id: 'tree-1' }, argsDone: true });
    expect(turn.badCalls).toEqual([]);
  });

  it('exposes best-effort partial args in live snapshots', () => {
    const a = make();
    a.push({ t: 'tool-start', callId: 'c1', name: 'paint_terrain' });
    a.push({ t: 'tool-args', callId: 'c1', delta: '{"type":"mountain","cells":[[1,2],[1,' });
    const live = a.snapshot();
    // `parsePartial`'s repair treats the trailing "1" as a complete number (a digit followed by a
    // comma can't extend it) and closes the dangling inner array around it, so the best-effort
    // read includes the started-but-incomplete second cell as `[1]` rather than dropping it.
    expect(live[0]).toMatchObject({ kind: 'tool', input: { type: 'mountain', cells: [[1, 2], [1]] }, argsDone: false });
  });

  it('marks a call bad when final args are unparseable, keeping the raw', () => {
    const a = make();
    a.push({ t: 'tool-start', callId: 'c1', name: 'build_road' });
    a.push({ t: 'tool-args', callId: 'c1', delta: '{"from":' });
    a.push({ t: 'done', stop: 'tool-calls', final: [{ callId: 'c1', name: 'build_road', args: undefined, rawArgs: '{"from":' }] });
    const turn = a.finish();
    expect(turn.badCalls).toEqual(['c1']);
    expect((turn.parts[0] as { rawInput?: string }).rawInput).toBe('{"from":');
  });

  it('fails the WHOLE batch on a length stop', () => {
    const a = make();
    a.push({ t: 'tool-start', callId: 'c1', name: 'place_object' });
    a.push({ t: 'tool-args', callId: 'c1', delta: '{"id":"a"}' });
    a.push({ t: 'tool-start', callId: 'c2', name: 'place_object' });
    a.push({ t: 'done', stop: 'length', final: [
      { callId: 'c1', name: 'place_object', args: { id: 'a' }, rawArgs: '{"id":"a"}' },
      { callId: 'c2', name: 'place_object', args: undefined, rawArgs: '' },
    ] });
    expect(a.finish().badCalls).toEqual(['c1', 'c2']);
  });

  it('carries an error event through finish as a value', () => {
    const a = make();
    a.push({ t: 'text', delta: 'part' });
    a.push({ t: 'error', error: { cls: 'network', detail: 'fetch failed' } });
    const turn = a.finish();
    expect(turn.stop).toBe('error');
    expect(turn.error).toMatchObject({ cls: 'network' });
    expect(turn.parts[0]).toMatchObject({ text: 'part' });
  });

  it('a snapshot between pushes reuses part objects that did not change', () => {
    const a = make();
    a.push({ t: 'text', delta: 'x' });
    a.push({ t: 'tool-start', callId: 'c1', name: 'undo' });
    const s1 = a.snapshot();
    a.push({ t: 'tool-args', callId: 'c1', delta: '{"a":1}' });
    const s2 = a.snapshot();
    expect(s2[0]).toBe(s1[0]);
    expect(s2[1]).not.toBe(s1[1]);
  });

  it('finish without a done or error event reports an aborted stop with the partial parts', () => {
    const a = make();
    a.push({ t: 'text', delta: 'partial' });
    const turn = a.finish();
    expect(turn.stop).toBe('aborted');
    expect(turn.parts[0]).toMatchObject({ kind: 'text', text: 'partial' });
    expect(turn.badCalls).toEqual([]);
  });

  it('a repeated tool-start for the same callId reuses the existing part instead of opening a second', () => {
    const a = make();
    a.push({ t: 'tool-start', callId: 'c1', name: 'place_object' });
    a.push({ t: 'tool-args', callId: 'c1', delta: '{"id":"a"' });
    a.push({ t: 'tool-start', callId: 'c1', name: 'place_object' });
    a.push({ t: 'tool-args', callId: 'c1', delta: '}' });
    a.push({ t: 'done', stop: 'tool-calls', final: [{ callId: 'c1', name: 'place_object', args: { id: 'a' }, rawArgs: '{"id":"a"}' }] });
    const turn = a.finish();
    expect(turn.parts).toHaveLength(1);
    expect(turn.parts[0]).toMatchObject({ kind: 'tool', callId: 'c1', input: { id: 'a' }, argsDone: true });
  });

  it('a final call with no streamed tool-start is appended rather than dropped', () => {
    const a = make();
    a.push({ t: 'text', delta: 'ok' });
    a.push({ t: 'done', stop: 'tool-calls', final: [{ callId: 'c9', name: 'undo', args: { steps: 1 }, rawArgs: '{"steps":1}' }] });
    const turn = a.finish();
    expect(turn.parts.map((p) => p.kind)).toEqual(['text', 'tool']);
    expect(turn.parts[1]).toMatchObject({ kind: 'tool', callId: 'c9', name: 'undo', input: { steps: 1 }, argsDone: true });
    expect(turn.badCalls).toEqual([]);
  });

  it('an unstreamed final call with unparseable args is still appended and joins badCalls', () => {
    const a = make();
    a.push({ t: 'done', stop: 'tool-calls', final: [{ callId: 'c9', name: 'undo', args: undefined, rawArgs: '{"steps":' }] });
    const turn = a.finish();
    expect(turn.parts).toHaveLength(1);
    expect(turn.parts[0]).toMatchObject({ kind: 'tool', callId: 'c9', argsDone: true, rawInput: '{"steps":' });
    expect(turn.badCalls).toEqual(['c9']);
  });

  /** The marker rides the `done` event and belongs to the TURN, so the log can record how the parts
   *  beside it were arrived at. A turn the adapter had nothing to normalize carries no key at all. */
  it('carries an adapter quirk through to the finished turn, and none where the wire was ordinary', () => {
    const marked = make();
    marked.push({ t: 'tool-start', callId: 'c1', name: 'find_flat_areas' });
    marked.push({ t: 'tool-args', callId: 'c1', delta: '{}' });
    marked.push({
      t: 'done', stop: 'tool-calls', quirks: ['tool-call-as-prose'],
      final: [{ callId: 'c1', name: 'find_flat_areas', args: {}, rawArgs: '{}' }],
    });
    expect(marked.finish().quirks).toEqual(['tool-call-as-prose']);

    const plain = make();
    plain.push({ t: 'text', delta: 'done' });
    plain.push({ t: 'done', stop: 'stop' });
    expect(plain.finish()).not.toHaveProperty('quirks');
  });

  it('a tool-args delta that reparses to the same value keeps the part and its input identity', () => {
    const a = make();
    a.push({ t: 'tool-start', callId: 'c1', name: 'undo' });
    a.push({ t: 'tool-args', callId: 'c1', delta: '{"a":1}' });
    const s1 = a.snapshot();
    // A trailing space grows the raw buffer but JSON.parse tolerates it, so the parsed value is
    // unchanged even though the buffer differs from the one that produced s1.
    a.push({ t: 'tool-args', callId: 'c1', delta: ' ' });
    const s2 = a.snapshot();
    expect(s2[0]).toBe(s1[0]);
    expect((s2[0] as { input: unknown }).input).toBe((s1[0] as { input: unknown }).input);
  });
});
