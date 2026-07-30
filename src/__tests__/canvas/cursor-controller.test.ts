import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetCursorController, registerCursorSurface, resolveCursor,
  setCursorBusy, setCursorForbidden, setCursorOverSelected, setCursorCtrlHint,
  setCursorPressSelects, setToolCursor, type CursorState,
} from '../../canvas/interaction/cursor-controller';
import { cursorCss } from '../../ui/cursors/cursor-css';

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
    expect(resolveCursor(state({ drag: 'pan' }))).toEqual({ id: 'hand-closed', forbidden: false });
    expect(resolveCursor(state({ drag: 'orbit' }))).toEqual({ id: 'orbit', forbidden: false });
  });

  it('lets busy outrank everything', () => {
    expect(resolveCursor(state({ busy: true, drag: 'pan', forbidden: true })))
      .toEqual({ id: 'busy', forbidden: false });
  });

  it('upgrades select to move ONLY where the pointer is over the selected object', () => {
    // "Over the selected object" is positional, so it arrives from the pointer machine, not from
    // a store-driven tool getter — which is what used to turn the whole canvas into a move
    // cursor after one click on one object.
    expect(resolveCursor(state({ tool: 'select', overSelected: true })))
      .toEqual({ id: 'move', forbidden: false });
    expect(resolveCursor(state({ tool: 'select', overSelected: false })).id).toBe('select');
    // Not a mode: any other tool keeps its own cursor even when something is selected.
    expect(resolveCursor(state({ tool: 'mountain', overSelected: true })).id).toBe('mountain');
    expect(resolveCursor(state({ tool: 'marquee', overSelected: true })).id).toBe('marquee');
  });

  it('keeps the precedence over the move upgrade: busy and drags still win', () => {
    const over = { tool: 'select', overSelected: true } as const;
    expect(resolveCursor(state({ ...over, drag: 'pan' })).id).toBe('hand-closed');
    expect(resolveCursor(state({ ...over, drag: 'orbit' })).id).toBe('orbit');
    expect(resolveCursor(state({ ...over, busy: true })).id).toBe('busy');
  });

  it('cannot smuggle a badge onto move, which is not FORBIDDABLE', () => {
    // The badge is re-checked against the UPGRADED id, so `select` + forbidden + overSelected
    // resolves to a plain move: a move has no refusable question at hover time (the drop cell
    // is unknown until the drag ends).
    expect(resolveCursor(state({ tool: 'select', overSelected: true, forbidden: true })))
      .toEqual({ id: 'move', forbidden: false });
  });

  it('drops the badge on cursors that cannot be refused', () => {
    expect(resolveCursor(state({ tool: 'marquee', forbidden: true })).forbidden).toBe(false);
    expect(resolveCursor(state({ tool: 'select', forbidden: true })).forbidden).toBe(false);
    expect(resolveCursor(state({ tool: 'eraser', forbidden: true })).forbidden).toBe(true);
  });

  it('lets a live Ctrl hint outrank the tool cursor, without ever carrying a badge', () => {
    // Without this, holding Ctrl over an object looks identical to not holding it.
    expect(resolveCursor(state({ tool: 'hand-open', ctrlHint: 'select-add' })))
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
    expect(resolveCursor(state({ ...hinted, drag: 'pan' })).id).toBe('hand-closed');
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

  it('writes the move upgrade through, and takes it back when the pointer leaves the object', () => {
    const el = document.createElement('div');
    registerCursorSurface(el);
    setToolCursor('select');
    setCursorOverSelected(true);
    expect(el.style.cursor).toBe(cursorCss('move'));
    setCursorOverSelected(false);
    expect(el.style.cursor).toBe(cursorCss('select'));
  });

  it('writes the Ctrl hint through, and takes it back when it clears', () => {
    const el = document.createElement('div');
    registerCursorSurface(el);
    setToolCursor('hand-open');
    setCursorCtrlHint('select-add');
    expect(el.style.cursor).toBe(cursorCss('select-add'));
    setCursorCtrlHint(null);
    expect(el.style.cursor).toBe(cursorCss('hand-open'));
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
