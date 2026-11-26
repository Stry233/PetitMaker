// @vitest-environment jsdom
/**
 * A copy as clipboard text: what one tab writes another reads back as the same arrangement, and text
 * that is not a sound copy from this release is never taken for one. A paste into a text field is
 * the field's own.
 */
import { describe, expect, afterEach } from 'vitest';
import { spec } from '../../_support/spec';
import { decodeArrangement, encodeArrangement } from '../../../io/clipboard/payload';
import { installClipboardBridge } from '../../../editor/editing/clipboard';
import { COMMAND_BY_ID, type CommandContext } from '../../../editor/commands/commands';
import { useEditorStore } from '../../../state/store';
import { resetStore } from '../../_support/store';
import type { Arrangement } from '../../../state/clipboard';
import { TerrainType, type Corners } from '../../../core/model/types';

const ROW: Arrangement = {
  members: [
    { catalogId: 'flower-rose', x: 0, y: 0, rotation: 0, rise: 0 },
    { catalogId: 'path-overgrown-dirt', x: 1, y: 0, rotation: 0, rise: 1, corners: ['fan', 'square', 'square', 'tri-SE'] },
    { catalogId: 'flower-daisy', x: 1, y: 1, rotation: 0, rise: 0 },
  ],
  w: 2,
  h: 2,
};

/** A placed blueprint copied whole: a 4 by 5 frame, so 5 by 6 terrain cells, a raised block and
 *  water among them, a road and a rose standing in it. */
const GROUP: Arrangement = {
  members: [
    { catalogId: 'path-overgrown-dirt', x: 0, y: 4, rotation: 0, rise: 0 },
    { catalogId: 'flower-rose', x: 2, y: 1, rotation: 0, rise: 1 },
  ],
  w: 4,
  h: 5,
  origin: { x: 20, y: 9 },
  group: {
    cells: Array.from({ length: 30 }, (_, k) => (k === 7 ? { type: TerrainType.Mountain, rise: 1, corners: ['fan', 'square', 'square', 'tri-SE'] as Corners }
      : k === 13 ? { type: TerrainType.Water, rise: 0 } : null)),
    base: 1,
    seed: { blueprint: 'bp-1', name: 'Terrace', origin: 'Mei' },
  },
};

const wire = (over: Record<string, unknown>) => JSON.stringify({ petitmaker: 'objects', v: 1, members: [{ id: 'flower-rose', x: 0, y: 0, r: 0, z: 0 }], ...over });

/** A `paste` event carrying `text`, dispatched at `target`. */
function pasteEvent(target: EventTarget, text: string): Event {
  const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
  Object.defineProperty(e, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? text : '') } });
  target.dispatchEvent(e);
  return e;
}

let stop: (() => void) | null = null;
afterEach(() => { stop?.(); stop = null; document.body.innerHTML = ''; });

describe('the clipboard text of a copy', () => {
  spec('EDIT-62', 'a copy reads back as the same arrangement, corners and heights included', () => {
    const read = decodeArrangement(encodeArrangement(ROW));
    expect(read).toEqual({ kind: 'ok', arrangement: ROW, unknown: 0 });
  });

  spec('EDIT-54', 'a copy carries the place it was copied from, held to its members when unknown ones are left out', () => {
    expect(decodeArrangement(encodeArrangement({ ...ROW, origin: { x: 12, y: 7 } }))).toEqual({ kind: 'ok', arrangement: { ...ROW, origin: { x: 12, y: 7 } }, unknown: 0 });
    const read = decodeArrangement(wire({ at: { x: 10, y: 4 }, members: [{ id: 'no-such-item', x: 0, y: 0, r: 0, z: 0 }, { id: 'flower-rose', x: 2, y: 3, r: 0, z: 0 }] }));
    expect(read.kind === 'ok' && read.arrangement?.origin).toEqual({ x: 12, y: 7 });
    for (const at of [{ x: -1, y: 0 }, { x: 0.5, y: 0 }, { x: 1e9, y: 0 }, [3, 4], 'here']) {
      expect(decodeArrangement(wire({ at })).kind, JSON.stringify(at)).toBe('malformed');
    }
  });

  spec('EDIT-62', 'other text, a broken copy and a copy from a newer release are not taken for a copy', () => {
    expect(decodeArrangement('hello').kind).toBe('not-a-copy');
    expect(decodeArrangement('{"a":1}').kind).toBe('not-a-copy');
    expect(decodeArrangement(wire({ v: 3 })).kind).toBe('future');
    for (const bad of [
      wire({ members: 'x' }),
      wire({ members: [{ id: 'flower-rose', x: 0.3, y: 0, r: 0, z: 0 }] }),
      wire({ members: [{ id: 'flower-rose', x: 0, y: 0, r: 45, z: 0 }] }),
      wire({ members: [{ id: 'flower-rose', x: 0, y: 0, r: 0, z: -1 }] }),
      wire({ members: [{ id: 'flower-rose', x: 1e9, y: 0, r: 0, z: 0 }] }),
      wire({ members: [{ id: 'flower-rose', x: 0, y: 0, r: 0, z: 0, corners: ['bogus'] }] }),
      wire({ members: Array.from({ length: 5000 }, () => ({ id: 'flower-rose', x: 0, y: 0, r: 0, z: 0 })) }),
    ]) expect(decodeArrangement(bad).kind, bad.slice(0, 80)).toBe('malformed');
  });

  spec('EDIT-62', 'a placed blueprint copied whole reads back with its terrain and the group it records', () => {
    const read = decodeArrangement(encodeArrangement(GROUP));
    expect(read).toEqual({ kind: 'ok', arrangement: GROUP, unknown: 0 });
    // Members naming unknown items are left out and counted, the rest kept where the frame holds them.
    const text = JSON.parse(encodeArrangement(GROUP)) as { members: unknown[] };
    text.members.push({ id: 'no-such-item', x: 0, y: 0, r: 0, z: 0 });
    const partial = decodeArrangement(JSON.stringify(text));
    expect(partial).toEqual({ kind: 'ok', arrangement: GROUP, unknown: 1 });
  });

  spec('EDIT-62', 'a copy of objects an older release wrote still reads, and a broken group copy is refused', () => {
    // The version 1 text a release before group copies wrote.
    const old = '{"petitmaker":"objects","v":1,"members":[{"id":"flower-rose","x":0,"y":0,"r":0,"z":0}],"at":{"x":3,"y":4}}';
    expect(decodeArrangement(old)).toEqual({
      kind: 'ok', arrangement: { members: [{ catalogId: 'flower-rose', x: 0, y: 0, rotation: 0, rise: 0 }], w: 1, h: 1, origin: { x: 3, y: 4 } }, unknown: 0,
    });
    expect(decodeArrangement(encodeArrangement(ROW)).kind).toBe('ok');
    expect(JSON.parse(encodeArrangement(ROW)).v, 'a copy of objects stays readable by older releases').toBe(1);
    const group = (over: Record<string, unknown>) => {
      const raw = JSON.parse(encodeArrangement(GROUP)) as { group: Record<string, unknown> };
      return JSON.stringify({ ...raw, group: { ...raw.group, ...over } });
    };
    expect(decodeArrangement(JSON.stringify({ ...JSON.parse(encodeArrangement(GROUP)), v: 3 })).kind).toBe('future');
    for (const bad of [
      group({ cells: [] }),
      group({ cells: Array.from({ length: 30 }, () => ({ type: 7, rise: 0 })) }),
      group({ cells: Array.from({ length: 30 }, () => ({ type: TerrainType.Mountain, rise: -1 })) }),
      group({ name: 7 }),
      group({ name: '  ' }),
      group({ w: 0 }),
      group({ w: 1e6 }),
      group({ base: -1 }),
      group({ blueprint: '' }),
      JSON.stringify({ ...JSON.parse(encodeArrangement(GROUP)), group: 'x' }),
    ]) expect(decodeArrangement(bad).kind, bad.slice(-120)).toBe('malformed');
  });

  spec('EDIT-62', 'members naming items this release does not know are left out and counted', () => {
    const read = decodeArrangement(wire({ members: [{ id: 'flower-rose', x: 2, y: 3, r: 0, z: 0 }, { id: 'no-such-item', x: 0, y: 0, r: 0, z: 0 }] }));
    expect(read.kind === 'ok' && read.unknown).toBe(1);
    expect(read.kind === 'ok' && read.arrangement?.members).toEqual([{ catalogId: 'flower-rose', x: 0, y: 0, rotation: 0, rise: 0 }]);
  });

  spec('EDIT-62', 'the paste key takes a copy from the system clipboard, and a text field keeps its own paste', async () => {
    resetStore();
    stop = installClipboardBridge();
    const field = document.body.appendChild(document.createElement('input'));
    const run = () => COMMAND_BY_ID.get('selection.paste')!.run({ toggleMenu: () => {} } as unknown as CommandContext);
    run();
    const inField = pasteEvent(field, encodeArrangement(ROW));
    expect(inField.defaultPrevented).toBe(false);
    const onMap = pasteEvent(document.body, encodeArrangement(ROW));
    expect(onMap.defaultPrevented).toBe(true);
    expect(useEditorStore.getState().clipboard).toEqual(ROW);
    await new Promise((r) => setTimeout(r, 0));
  });
});
