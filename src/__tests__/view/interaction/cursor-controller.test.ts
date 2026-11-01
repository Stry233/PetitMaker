// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetCursorController, pushCursorSurface, registerCursorSurface, releaseCursorSurface,
  setCursorBusy, setCursorForbidden, setCursorOverSelected, setCursorCtrlHint,
  setCursorDrag, setCursorPanReady, setCursorPressSelects, setToolCursor, type CursorState,
} from '../../../view/interaction/cursor-controller';
import { cursorCss } from '../../../assets/cursors/cursor-css';
import { useEditorStore } from '../../../state/store';
import type { CursorId } from '../../../assets/cursors/cursor-spec';

beforeEach(() => __resetCursorController());

/** The cursor a fresh controller writes on its surface for `over` (the tool `mountain` otherwise),
 *  under the painted set or, with `system`, the system cursors. */
function shown(over: Partial<CursorState> = {}, opts: { system?: boolean } = {}): string {
  __resetCursorController();
  useEditorStore.setState({ systemCursors: opts.system ?? false });
  const el = document.createElement('div');
  registerCursorSurface(el);
  setToolCursor(over.tool ?? 'mountain');
  if (over.forbidden !== undefined) setCursorForbidden(over.forbidden);
  if (over.overSelected !== undefined) setCursorOverSelected(over.overSelected);
  if (over.ctrlHint !== undefined) setCursorCtrlHint(over.ctrlHint);
  if (over.pressSelects !== undefined) setCursorPressSelects(over.pressSelects);
  if (over.panReady !== undefined) setCursorPanReady(over.panReady);
  if (over.drag !== undefined) setCursorDrag(over.drag);
  if (over.busy !== undefined) setCursorBusy(over.busy);
  const cursor = el.style.cursor;
  __resetCursorController();
  return cursor;
}

/** The cursor `id` reads as, with or without the forbidden badge. */
const css = (id: CursorId, forbidden = false, opts: { system?: boolean } = {}): string =>
  cursorCss(id, { forbidden, frame: 0, system: opts.system ?? false });

describe('the cursor a surface shows', () => {
  it('shows the held pan hint above tool refusal and selection hints in both cursor sets', () => {
    for (const system of [false, true]) {
      expect(shown({ panReady: true, forbidden: true, ctrlHint: 'select-add', overSelected: true }, { system })).toBe(css('move', false, { system }));
    }
    expect(shown({ panReady: true, drag: 'object' })).toBe(css('hand-closed', false));
    expect(shown({ panReady: true, drag: 'orbit' })).toBe(css('orbit', false));
    expect(shown({ panReady: true, busy: true })).toBe(css('busy', false));
  });

  it('keeps an overlay cursor while the underlying map pan key is held', () => {
    const surface = document.createElement('div');
    const overlay = document.createElement('div');
    registerCursorSurface(surface);
    setCursorPanReady(true);
    const release = pushCursorSurface(overlay, 'select');
    expect(overlay.style.cursor).toBe(cursorCss('select'));
    release();
    expect(surface.style.cursor).toBe(cursorCss('move'));
  });

  it('shows the tool when nothing else is happening', () => {
    expect(shown()).toBe(css('mountain', false));
  });

  it('lets a drag outrank the tool, because the drag is what is happening', () => {
    expect(shown({ drag: 'pan' })).toBe(css('move', false));
    expect(shown({ drag: 'orbit' })).toBe(css('orbit', false));
  });

  it('lets busy outrank the tool, and a live drag outrank busy', () => {
    expect(shown({ busy: true, forbidden: true })).toBe(css('busy', false));
    // A drag is the user's own hand mid-gesture: replacing the pan cursor with a work-in-progress
    // one would take away the only sign the drag is still live.
    expect(shown({ busy: true, drag: 'pan' })).toBe(css('move', false));
    expect(shown({ busy: true, drag: 'object' })).toBe(css('hand-closed', false));
  });

  it('closes a hand on a system-cursor pan, where the painted cross keeps its own drawing', () => {
    // macOS renders the `move` keyword as the open hand, so a system-cursor pan that kept the id
    // would show a hand that never closes however much the user clicked and dragged.
    expect(shown({ drag: 'pan' }, { system: true })).toBe(css('hand-closed', false, { system: true }));
    expect(shown({ drag: 'pan' }, { system: false })).toBe(css('move', false, { system: false }));
    expect(shown({ drag: 'pan' })).toBe(css('move', false));
  });

  it('opens the hand ONLY where the pointer is over the selected object', () => {
    // "Over the selected object" is positional, so it comes from the pointer machine, never a tool getter.
    expect(shown({ tool: 'select', overSelected: true })).toBe(css('hand-open', false));
    expect(shown({ tool: 'select', overSelected: false })).toBe(css('select', false));
    // The move tool drags a selected object too, so it upgrades on the same terms.
    expect(shown({ tool: 'move', overSelected: true })).toBe(css('hand-open', false));
    // The grab upgrades any tool's cursor (the note tool's chip mode shows `place`); a press that
    // paints never reports `overSelected` (press-plan.test.ts).
    expect(shown({ tool: 'place', overSelected: true })).toBe(css('hand-open', false));
    expect(shown({ tool: 'mountain', overSelected: false })).toBe(css('mountain', false));
  });

  it('keeps the precedence over the grab upgrade: busy and drags still win', () => {
    const over = { tool: 'select', overSelected: true } as const;
    expect(shown({ ...over, drag: 'pan' })).toBe(css('move', false));
    expect(shown({ ...over, drag: 'orbit' })).toBe(css('orbit', false));
    expect(shown({ ...over, busy: true })).toBe(css('busy', false));
  });

  it('cannot smuggle a badge onto the grab, which is not FORBIDDABLE', () => {
    // The badge is re-checked against the upgraded id: a grab's drop cell is unknown at hover time.
    expect(shown({ tool: 'select', overSelected: true, forbidden: true })).toBe(css('hand-open', false));
  });

  it('drops the badge on cursors that cannot be refused', () => {
    expect(shown({ tool: 'marquee', forbidden: true })).toBe(css('marquee', false));
    expect(shown({ tool: 'select', forbidden: true })).toBe(css('select', false));
    expect(shown({ tool: 'eraser', forbidden: true })).toBe(css('eraser', true));
  });

  it('lets a live Ctrl hint outrank the tool cursor, without ever carrying a badge', () => {
    // Without this, holding Ctrl over an object looks identical to not holding it.
    expect(shown({ tool: 'move', ctrlHint: 'select-add' })).toBe(css('select-add', false));
    expect(shown({ tool: 'select', ctrlHint: 'select-remove' })).toBe(css('select-remove', false));
    expect(shown({ tool: 'select', ctrlHint: 'marquee' })).toBe(css('marquee', false));
    expect(shown({ ctrlHint: 'select-add', forbidden: true })).toBe(css('select-add', false));
  });

  it('says select where the press selects instead of placing, badge-free', () => {
    // With an item armed, a press over an existing object selects rather than places.
    expect(shown({ tool: 'place', pressSelects: true, forbidden: true })).toBe(css('select', false));
    expect(shown({ tool: 'place', pressSelects: false, forbidden: true })).toBe(css('place', true));
    // Ctrl outranks it: its own gesture (toggle / rubber band) is what the click would do.
    expect(shown({ tool: 'place', pressSelects: true, ctrlHint: 'select-add' })).toBe(css('select-add'));
  });

  it('keeps the precedence over the Ctrl hint: busy and drags still win', () => {
    const hinted = { ctrlHint: 'select-add' } as const;
    expect(shown({ ...hinted, drag: 'pan' })).toBe(css('move', false));
    expect(shown({ ...hinted, drag: 'orbit' })).toBe(css('orbit', false));
    expect(shown({ ...hinted, busy: true })).toBe(css('busy', false));
  });
});

describe('writing to the surface', () => {
  it('writes the resolved value to the registered element', () => {
    const el = document.createElement('div');
    registerCursorSurface(el);
    setToolCursor('water');
    expect(el.style.cursor).toBe(cursorCss('water'));
    setCursorForbidden(true);
    expect(el.style.cursor).toBe(cursorCss('water', { forbidden: true }));
  });

  it('writes the grab upgrade through, and takes it back when the pointer leaves the object', () => {
    const el = document.createElement('div');
    registerCursorSurface(el);
    setToolCursor('select');
    setCursorOverSelected(true);
    expect(el.style.cursor).toBe(cursorCss('hand-open'));
    setCursorOverSelected(false);
    expect(el.style.cursor).toBe(cursorCss('select'));
  });

  it('writes the Ctrl hint through, and takes it back when it clears', () => {
    const el = document.createElement('div');
    registerCursorSurface(el);
    setToolCursor('move');
    setCursorCtrlHint('select-add');
    expect(el.style.cursor).toBe(cursorCss('select-add'));
    setCursorCtrlHint(null);
    expect(el.style.cursor).toBe(cursorCss('move'));
  });

  it('writes the select-instead-of-place fact through, and takes it back', () => {
    const el = document.createElement('div');
    registerCursorSurface(el);
    setToolCursor('place');
    setCursorPressSelects(true);
    expect(el.style.cursor).toBe(cursorCss('select'));
    setCursorPressSelects(false);
    expect(el.style.cursor).toBe(cursorCss('place'));
  });

  it('survives having no surface, and adopts one registered later', () => {
    expect(() => setToolCursor('eraser')).not.toThrow();
    const el = document.createElement('div');
    registerCursorSurface(el);
    expect(el.style.cursor).toBe(cursorCss('eraser'));
  });

  it('clears the surface it leaves, so a stale cursor cannot persist', () => {
    const el = document.createElement('div');
    registerCursorSurface(el);
    setToolCursor('place');
    registerCursorSurface(null);
    expect(el.style.cursor).toBe('');
  });

});

describe('an overlay borrowing the surface', () => {
  it('hands the surface back to the canvas when the overlay closes', () => {
    // A full-screen overlay (the export shot editor) draws over a canvas that stays mounted and
    // never re-registers, so the close hands the surface back.
    const canvas = document.createElement('div');
    const overlay = document.createElement('div');
    registerCursorSurface(canvas);
    setToolCursor('mountain');
    expect(canvas.style.cursor).toBe(cursorCss('mountain'));

    const restore = pushCursorSurface(overlay);
    setToolCursor('move');
    expect(overlay.style.cursor).toBe(cursorCss('move'));
    expect(canvas.style.cursor).toBe('');

    restore();
    expect(overlay.style.cursor).toBe('');
    expect(canvas.style.cursor).toBe(cursorCss('move'));
  });

  it('restores idempotently', () => {
    const canvas = document.createElement('div');
    registerCursorSurface(canvas);
    const restore = pushCursorSurface(document.createElement('div'));
    restore();
    restore();
    setToolCursor('water');
    expect(canvas.style.cursor).toBe(cursorCss('water'));
  });

  it('lands on whichever canvas is registered NOW, not the one that was there at push time', () => {
    // The 2D/3D toggle re-registers the base underneath an open overlay.
    const first = document.createElement('div');
    const second = document.createElement('div');
    registerCursorSurface(first);
    const restore = pushCursorSurface(document.createElement('div'));
    registerCursorSurface(second);
    restore();
    setToolCursor('eraser');
    expect(second.style.cursor).toBe(cursorCss('eraser'));
    expect(first.style.cursor).toBe('');
  });

  it('keeps the overlay on top while it is up: a base re-register cannot steal the surface', () => {
    const canvas = document.createElement('div');
    const overlay = document.createElement('div');
    registerCursorSurface(canvas);
    const restore = pushCursorSurface(overlay);
    registerCursorSurface(canvas);
    setToolCursor('road');
    expect(overlay.style.cursor).toBe(cursorCss('road'));
    expect(canvas.style.cursor).toBe('');
    restore();
  });

  it('shows the cursor the claim asked for, and leaves the app tool cursor untouched', () => {
    const canvas = document.createElement('div');
    const overlay = document.createElement('div');
    registerCursorSurface(canvas);
    setToolCursor('mountain');
    const restore = pushCursorSurface(overlay, 'move');
    expect(overlay.style.cursor).toBe(cursorCss('move'));
    restore();
    expect(canvas.style.cursor).toBe(cursorCss('mountain'));
  });

  it('lets a drag outrank the claim, the same way it outranks a tool', () => {
    const overlay = document.createElement('div');
    const restore = pushCursorSurface(overlay, 'move');
    setCursorDrag('orbit');
    expect(overlay.style.cursor).toBe(cursorCss('orbit'));
    setCursorDrag('none');
    expect(overlay.style.cursor).toBe(cursorCss('move'));
    restore();
  });

  it('ignores a canvas releasing a surface the overlay has borrowed', () => {
    const canvas = document.createElement('div');
    const overlay = document.createElement('div');
    registerCursorSurface(canvas);
    const restore = pushCursorSurface(overlay);
    releaseCursorSurface(canvas);
    restore();
    setToolCursor('water');
    expect(canvas.style.cursor).toBe('');
  });
});

describe('busy', () => {
  it('takes over the surface while a long operation runs, animates its ring, and hands it back', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    registerCursorSurface(el);
    setToolCursor('mountain');
    setCursorBusy(true);
    // The one animated cursor: frame 0 lands at once, and the controller's own clock advances the
    // ring while the state holds; nothing else writes style.cursor, so the ticking is its job.
    expect(el.style.cursor).toBe(cursorCss('busy'));
    expect(el.style.cursor).toContain('busy-0');
    vi.advanceTimersByTime(125);
    expect(el.style.cursor).toContain('busy-1');
    vi.advanceTimersByTime(125 * 3);
    expect(el.style.cursor).toContain('busy-4');
    setCursorBusy(false);
    expect(el.style.cursor).toBe(cursorCss('mountain'));
    // The clock stops with the state: no further tick rewrites the surface.
    const settled = el.style.cursor;
    vi.advanceTimersByTime(1000);
    expect(el.style.cursor).toBe(settled);
    vi.useRealTimers();
  });

  it('sits above the tool and below a live drag', () => {
    // The tool cannot act until a background job lands, and a drag's cursor is the only sign it is live.
    const el = document.createElement('div');
    registerCursorSurface(el);
    setToolCursor('mountain');
    setCursorForbidden(true);
    setCursorBusy(true);
    expect(el.style.cursor).toBe(cursorCss('busy'));

    setCursorDrag('pan');
    expect(el.style.cursor).toBe(cursorCss('move'));
    setCursorDrag('object');
    expect(el.style.cursor).toBe(cursorCss('hand-closed'));

    setCursorDrag('none');
    expect(el.style.cursor).toBe(cursorCss('busy'));
    setCursorBusy(false);
    expect(el.style.cursor).toBe(cursorCss('mountain', { forbidden: true }));
  });
});
