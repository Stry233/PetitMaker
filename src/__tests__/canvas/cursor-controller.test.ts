import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetCursorController, pushCursorSurface, registerCursorSurface, releaseCursorSurface,
  resolveCursor, setCursorBusy, setCursorForbidden, setCursorOverSelected, setCursorCtrlHint,
  setCursorDrag, setCursorPressSelects, setToolCursor, type CursorState,
} from '../../canvas/interaction/cursor-controller';
import { cursorCss } from '../../assets/cursors/cursor-css';

const state = (over: Partial<CursorState> = {}): CursorState => ({
  tool: 'mountain', forbidden: false, overSelected: false, ctrlHint: null,
  pressSelects: false, drag: 'none', busy: false, ...over,
});

beforeEach(() => __resetCursorController());

describe('resolveCursor precedence', () => {
  it('shows the tool when nothing else is happening', () => {
    expect(resolveCursor(state())).toEqual({ id: 'mountain', forbidden: false });
  });

  it('lets a drag outrank the tool, because the drag is what is happening', () => {
    expect(resolveCursor(state({ drag: 'pan' }))).toEqual({ id: 'move', forbidden: false });
    expect(resolveCursor(state({ drag: 'orbit' }))).toEqual({ id: 'orbit', forbidden: false });
  });

  it('lets busy outrank everything', () => {
    expect(resolveCursor(state({ busy: true, drag: 'pan', forbidden: true })))
      .toEqual({ id: 'busy', forbidden: false });
  });

  it('opens the hand ONLY where the pointer is over the selected object', () => {
    // "Over the selected object" is positional, so it arrives from the pointer machine, not from
    // a store-driven tool getter — which is what used to turn the whole canvas into a grab
    // cursor after one click on one object.
    expect(resolveCursor(state({ tool: 'select', overSelected: true })))
      .toEqual({ id: 'hand-open', forbidden: false });
    expect(resolveCursor(state({ tool: 'select', overSelected: false })).id).toBe('select');
    // The move tool drags a selected object too, so it upgrades on the same terms.
    expect(resolveCursor(state({ tool: 'move', overSelected: true })).id).toBe('hand-open');
    // Not a mode: a tool that PAINTS keeps its own cursor even when something is selected, since
    // a press there paints rather than moves.
    expect(resolveCursor(state({ tool: 'mountain', overSelected: true })).id).toBe('mountain');
    expect(resolveCursor(state({ tool: 'marquee', overSelected: true })).id).toBe('marquee');
  });

  it('keeps the precedence over the grab upgrade: busy and drags still win', () => {
    const over = { tool: 'select', overSelected: true } as const;
    expect(resolveCursor(state({ ...over, drag: 'pan' })).id).toBe('move');
    expect(resolveCursor(state({ ...over, drag: 'orbit' })).id).toBe('orbit');
    expect(resolveCursor(state({ ...over, busy: true })).id).toBe('busy');
  });

  it('cannot smuggle a badge onto the grab, which is not FORBIDDABLE', () => {
    // The badge is re-checked against the UPGRADED id, so `select` + forbidden + overSelected
    // resolves to a plain open hand: a grab has no refusable question at hover time (the drop
    // cell is unknown until the drag ends).
    expect(resolveCursor(state({ tool: 'select', overSelected: true, forbidden: true })))
      .toEqual({ id: 'hand-open', forbidden: false });
  });

  it('drops the badge on cursors that cannot be refused', () => {
    expect(resolveCursor(state({ tool: 'marquee', forbidden: true })).forbidden).toBe(false);
    expect(resolveCursor(state({ tool: 'select', forbidden: true })).forbidden).toBe(false);
    expect(resolveCursor(state({ tool: 'eraser', forbidden: true })).forbidden).toBe(true);
  });

  it('lets a live Ctrl hint outrank the tool cursor, without ever carrying a badge', () => {
    // Without this, holding Ctrl over an object looks identical to not holding it.
    expect(resolveCursor(state({ tool: 'move', ctrlHint: 'select-add' })))
      .toEqual({ id: 'select-add', forbidden: false });
    expect(resolveCursor(state({ tool: 'select', ctrlHint: 'select-remove' })).id).toBe('select-remove');
    expect(resolveCursor(state({ tool: 'select', ctrlHint: 'marquee' })).id).toBe('marquee');
    expect(resolveCursor(state({ ctrlHint: 'select-add', forbidden: true })).forbidden).toBe(false);
  });

  it('says select where the press selects instead of placing, badge-free', () => {
    // With an item armed the tool cursor is `place`, and over an existing object that press
    // SELECTS — showing a badged `place` there would name an action the click never attempts.
    expect(resolveCursor(state({ tool: 'place', pressSelects: true, forbidden: true })))
      .toEqual({ id: 'select', forbidden: false });
    expect(resolveCursor(state({ tool: 'place', pressSelects: false, forbidden: true })))
      .toEqual({ id: 'place', forbidden: true });
    // Ctrl outranks it: its own gesture (toggle / rubber band) is what the click would do.
    expect(resolveCursor(state({ tool: 'place', pressSelects: true, ctrlHint: 'select-add' })).id)
      .toBe('select-add');
  });

  it('keeps the precedence over the Ctrl hint: busy and drags still win', () => {
    const hinted = { ctrlHint: 'select-add' } as const;
    expect(resolveCursor(state({ ...hinted, drag: 'pan' })).id).toBe('move');
    expect(resolveCursor(state({ ...hinted, drag: 'orbit' })).id).toBe('orbit');
    expect(resolveCursor(state({ ...hinted, busy: true })).id).toBe('busy');
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

  it('writes ONLY when the resolved value changes', () => {
    // A pointer-move that does not change the hovered cell must not touch the DOM.
    const el = document.createElement('div');
    let writes = 0;
    Object.defineProperty(el.style, 'cursor', {
      get: () => '', set: () => { writes++; }, configurable: true,
    });
    registerCursorSurface(el);
    setToolCursor('road');
    const after = writes;
    setToolCursor('road');
    setCursorForbidden(false);
    expect(writes).toBe(after);
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

  it('writes ONLY when the RESOLVED value changes, even if the state genuinely changed: ' +
    'pins the apply()-level guard, distinct from the setter-level early return above. ' +
    'marquee/select are not FORBIDDABLE, so toggling `forbidden` changes `state` (the setter ' +
    'does not early-return) but resolveCursor ignores the badge for them, so the css is identical ' +
    'and apply() must still skip the DOM write.', () => {
    const el = document.createElement('div');
    let writes = 0;
    Object.defineProperty(el.style, 'cursor', {
      get: () => '', set: () => { writes++; }, configurable: true,
    });
    registerCursorSurface(el);
    setToolCursor('marquee');
    const after = writes;
    setCursorForbidden(true);
    expect(writes).toBe(after);
  });
});

describe('an overlay borrowing the surface', () => {
  it('hands the surface back to the canvas when the overlay closes', () => {
    // A full-screen overlay (the export shot editor) draws over a canvas that stays mounted, so
    // its effect never re-runs. Nulling the surface on close left the canvas with no cursor at
    // all — the platform arrow, until a view toggle happened to re-register it.
    const canvas = document.createElement('div');
    const overlay = document.createElement('div');
    registerCursorSurface(canvas);
    setToolCursor('mountain');
    expect(canvas.style.cursor).toBe(cursorCss('mountain'));

    const restore = pushCursorSurface(overlay);
    setToolCursor('move');
    expect(overlay.style.cursor).toBe(cursorCss('move'));
    expect(canvas.style.cursor).toBe(''); // the borrowed-from surface keeps no stale cursor

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
    // The 2D/3D toggle re-registers the base underneath an open overlay; the restore must follow
    // the live base rather than reinstating an element that no longer owns the screen.
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
    // The overlay names what IT shows rather than writing the tool cursor, so closing it has
    // nothing to put back: the canvas underneath resumes whatever tool was already armed.
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
  it('takes over the surface while a long operation runs, and hands it back', () => {
    const el = document.createElement('div');
    registerCursorSurface(el);
    setToolCursor('mountain');
    setCursorBusy(true);
    expect(el.style.cursor).toBe(cursorCss('busy'));
    expect(el.style.cursor).toBe('progress'); // keyword-only by design
    setCursorBusy(false);
    expect(el.style.cursor).toBe(cursorCss('mountain'));
  });
});
