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

const ROW: Arrangement = {
  members: [
    { catalogId: 'flower-rose', x: 0, y: 0, rotation: 0, rise: 0 },
    { catalogId: 'path-overgrown-dirt', x: 1, y: 0, rotation: 0, rise: 1, corners: ['fan', 'square', 'square', 'tri-SE'] },
    { catalogId: 'flower-daisy', x: 1, y: 1, rotation: 0, rise: 0 },
  ],
  w: 2,
  h: 2,
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
    expect(decodeArrangement(wire({ v: 2 })).kind).toBe('future');
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
