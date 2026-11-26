// @vitest-environment jsdom
/**
 * Backing out (UI-12) over a spec world opened in the editor store: states entered through the
 * editor's own verbs, then Escape as its command runs it, and Delete as the same newest state reads it.
 */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { world, type SpecWorld } from '../_world';
import { placeItem } from '../editing/_editing';
import { resetStore, setStoreState, armedEditMode } from '../../_support/store';
import { useEditorStore, type EditorStore } from '../../../state/store';
import { ToolType } from '../../../state/editing/vocabulary';
import { isContentMode } from '../../../state/editing/edit-mode';
import { explorerUnfolded } from '../../../state/slices/blueprint';
import { COMMAND_BY_ID, type CommandContext } from '../../../editor/commands/commands';
import { closeBrushBar, finishRegionPainting, watchBackStack } from '../../../editor/back/back-out';
import { toggleAgentRegion } from '../../../editor/editing/region-brush';
import { __setBlueprintLibrary, beginBlueprintFrame, unfoldBlueprintLibrary } from '../../../editor/editing/blueprint';
import { createBlueprintLibrary, memoryBlueprintBackend } from '../../../io/storage/blueprint-library';
import { makeRng } from '../../../core/base/rng';
import type { BlockRef } from '../../../state/selection';
import type { PlacedObject } from '../../../core/model/types';

const TREE = 'tree-apple';
const STALL = 'building-stall';
const s = (): EditorStore => useEditorStore.getState();
const key = (id: string): void => COMMAND_BY_ID.get(id)!.run({ toggleMenu: () => {} } as unknown as CommandContext);
const escape = (): void => key('selection.deselect');

/** Two trees on open ground, opened in the editor with the Hand tool up. */
function open(): { w: SpecWorld; a: PlacedObject; b: PlacedObject } {
  const w = world();
  const at = w.openGround(10, 6);
  const a = placeItem(w, TREE, { x: at.x + 1, y: at.y + 1 })!;
  const b = placeItem(w, TREE, { x: at.x + 5, y: at.y + 1 })!;
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [], ...armedEditMode({ tool: ToolType.Hand }) });
  return { w, a, b };
}

const objectRef = (o: PlacedObject): BlockRef => ({ kind: 'object', id: o.id });

/** The object shelf's brush bar stands, holding the card armed in it as part of its own state. */
const barOpen = (st: EditorStore): boolean => st.objectBrushBar && st.editMode.mode === 'object';

/** What a person sees standing, each as a key that changes when the state is entered anew; null
 *  where it does not stand. Listed outer first, the order states entering together take. */
const FACTS: readonly (readonly [string, (st: EditorStore) => string | null])[] = [
  ['assistant', (st) => (st.assistantOpen ? 'open' : null)],
  ['what\'s this', (st) => (st.whatsThis ? 'on' : null)],
  ['painting', (st) => (st.selectingRegion && st.regionSelectionOwner !== 'blueprint' ? st.regionSelectionOwner : null)],
  ['brush bar', (st) => (barOpen(st) ? JSON.stringify(st.editMode.arming) : null)],
  ['note tool', (st) => (st.editMode.mode === 'annotate' && st.annotationTool !== 'none' ? st.annotationTool : null)],
  ['explorer', (st) => (explorerUnfolded(st.blueprintStep) ? String(st.blueprintStep.id) : null)],
  ['frame step', (st) => (st.blueprintStep.at === 'frame' ? String(st.blueprintStep.id) : null)],
  ['armed', (st) => (!barOpen(st) && st.editMode.arming.kind !== 'none' && (isContentMode(st.editMode.mode) || st.editMode.mode === 'object')
    ? `${st.editMode.mode}:${JSON.stringify(st.editMode.arming)}` : null)],
  ['selection', (st) => (st.selection.length > 0 ? JSON.stringify(st.selection) : null)],
  ['menu', (st) => (st.contextMenu ? JSON.stringify(st.contextMenu.target) : null)],
  ['question', (st) => (st.deletePopover ? JSON.stringify(st.deletePopover) : null)],
];

const facts = (): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [name, read] of FACTS) { const k = read(s()); if (k !== null) out.set(name, k); }
  return out;
};

/** The standing states in the order they were entered, kept by reading the facts after each act:
 *  a state standing anew or under a new key goes to the top, one no longer standing leaves. */
class Entered {
  order: string[] = [];
  keys = new Map<string, string>();
  /** The selection a step put down as it opened, under the step's name, which backing out of it gives back. */
  setAside = new Map<string, string>();
  read(): void {
    const now = facts();
    const ended = now.has('selection') ? undefined : this.keys.get('selection');
    // A step opening over another takes over the selection that one put aside.
    const handed = SETS_ASIDE.map((step) => (now.has(step) ? undefined : this.setAside.get(step))).find((k) => k !== undefined);
    for (const step of SETS_ASIDE) {
      const opened = now.has(step) && now.get(step) !== this.keys.get(step);
      if (opened && (ended ?? handed) !== undefined) this.setAside.set(step, (ended ?? handed)!);
      else if (!now.has(step)) this.setAside.delete(step);
    }
    this.order = this.order.filter((name) => now.has(name) && now.get(name) === this.keys.get(name));
    for (const [name] of now) if (!this.order.includes(name)) this.order.push(name);
    this.keys = now;
  }
}

/** The steps that put the map's selection aside as they open and give it back when backed out of (EDIT-25). */
const SETS_ASIDE = ['explorer', 'frame step'];

/** The ways a person enters a state, each through the editor's own verbs. */
function acts(a: PlacedObject, b: PlacedObject): Record<string, () => void> {
  return {
    assistant: () => s().setAssistantOpen(true),
    brush: () => s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } }),
    eraser: () => s().setEditMode({ mode: 'mountain', arm: { kind: 'erase' } }),
    item: () => s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: STALL } }),
    'other item': () => s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: TREE } }),
    'select a': () => s().setSelection([objectRef(a)]),
    'select both': () => s().setSelection([objectRef(a), objectRef(b)]),
    'agent painting': () => { if (!s().selectingRegion) toggleAgentRegion(); },
    'brush bar': () => { s().setEditMode({ mode: 'object' }); s().setObjectBrushBar(true); },
    'what\'s this': () => s().setWhatsThis(true),
    'generate scope': () => { s().setEditMode({ mode: 'generate' }); s().setSelectingRegion(true, 'generator'); },
    notes: () => s().setEditMode({ mode: 'annotate' }),
    explorer: () => { s().setEditMode({ mode: 'blueprint' }); unfoldBlueprintLibrary(true); },
    'frame step': () => { s().setEditMode({ mode: 'blueprint' }); beginBlueprintFrame(); },
    menu: () => s().setContextMenu({ x: 0, y: 0, target: objectRef(b), mode: 'pc' }),
    delete: () => key('selection.delete'),
  };
}

let stops: (() => void)[] = [];
beforeEach(() => {
  resetStore();
  stops = [__setBlueprintLibrary(createBlueprintLibrary(memoryBlueprintBackend())), watchBackStack()];
});
afterEach(() => { for (const stop of stops.reverse()) stop(); });

describe('backing out', () => {
  spec('UI-12', 'over random states entered one after another, each Escape ends exactly the newest standing state, and as many presses as states stood reach rest', () => {
    for (let seed = 1; seed <= 150; seed++) {
      resetStore();
      const { a, b } = open();
      const rng = makeRng(seed);
      const verbs = acts(a, b);
      const names = Object.keys(verbs);
      const entered = new Entered();
      const done: string[] = [];
      for (let n = 2 + rng.int(8); n > 0; n--) {
        const name = rng.pick(names);
        done.push(name);
        verbs[name]!();
        entered.read();
      }
      const at = `seed ${seed}: ${done.join(', ')}`;
      const standing = entered.order.length;
      let presses = 0;
      while (entered.order.length > 0) {
        const newest = entered.order[entered.order.length - 1]!;
        const before = new Map(entered.keys);
        escape();
        presses++;
        const now = facts();
        expect(now.has(newest) && now.get(newest) === before.get(newest), `${at}: Escape ${presses} left ${newest} standing`).toBe(false);
        for (const [name, k] of before) if (name !== newest) expect(now.get(name), `${at}: Escape ${presses} on ${newest} changed ${name}`).toBe(k);
        // A step backed out of gives back the selection it put aside, which then stands newest.
        const givenBack = entered.setAside.get(newest);
        for (const [name, k] of now) if (!before.has(name)) expect([name, k], `${at}: Escape ${presses} entered ${name}`).toEqual(['selection', givenBack]);
        entered.read();
        expect(presses, `${at}: more presses than states`).toBeLessThanOrEqual(standing + 1);
      }
      const rest = facts();
      escape();
      expect(facts(), `${at}: Escape at rest`).toEqual(rest);
    }
  });

  spec('EDIT-24', 'an object selected under an armed item clears first, a selection made before arming is already put down', () => {
    const { a } = open();
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: STALL } });
    s().setSelection([objectRef(a)]);
    escape();
    expect(s().selection).toEqual([]);
    expect(s().editMode.arming.kind).toBe('item');
    escape();
    expect(s().editMode.arming.kind).toBe('none');
  });

  spec('UI-12', 'a selection made after the assistant opened clears before the panel folds, and the panel folds before an older selection', () => {
    const { a } = open();
    s().setAssistantOpen(true);
    s().setSelection([objectRef(a)]);
    escape();
    expect(s().selection).toEqual([]);
    expect(s().assistantOpen).toBe(true);
    s().setSelection([objectRef(a)]);
    s().setAssistantOpen(false);
    s().setAssistantOpen(true);
    escape();
    expect(s().assistantOpen).toBe(false);
    expect(s().selection).toEqual([objectRef(a)]);
  });

  spec('UI-12', 'Escape ends Generate\'s and the assistant\'s painting before the item armed under it, which stays armed', () => {
    open();
    for (const start of [() => s().setSelectingRegion(true, 'generator'), () => toggleAgentRegion()]) {
      s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: STALL } });
      start();
      expect(s().selectingRegion).toBe(true);
      escape();
      expect(s().selectingRegion).toBe(false);
      expect(s().editMode.arming.kind).toBe('item');
      escape();
      expect(s().editMode.arming.kind).toBe('none');
    }
  });

  spec('EDIT-64', 'one Escape puts the brush bar away with the card armed in it, however the card was armed', () => {
    open();
    for (const armFirst of [true, false]) {
      s().setEditMode({ mode: 'object', arm: { kind: 'none' } });
      if (armFirst) s().setEditMode({ arm: { kind: 'item', itemId: STALL } });
      s().setObjectBrushBar(true);
      if (!armFirst) s().setEditMode({ arm: { kind: 'item', itemId: STALL } });
      expect(s().objectBrushBar).toBe(true);
      escape();
      expect([s().objectBrushBar, s().editMode.arming.kind]).toEqual([false, 'none']);
    }
  });

  spec('EDIT-64', 'the brush bar\'s Done puts the bar away and keeps the card armed, where a back-out puts both down', () => {
    open();
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: STALL } });
    s().setObjectBrushBar(true);
    closeBrushBar('keep');
    expect([s().objectBrushBar, s().editMode.arming.kind]).toEqual([false, 'item']);
    s().setObjectBrushBar(true);
    closeBrushBar('put-down');
    expect([s().objectBrushBar, s().editMode.arming.kind]).toEqual([false, 'none']);
  });

  spec('UI-12', 'the region screen\'s Done ends the painting as a back-out does and keeps the region', () => {
    open();
    s().setEditMode({ mode: 'generate' });
    for (const end of [finishRegionPainting, escape]) {
      s().setSelectingRegion(true, 'generator');
      s().commitRegion([{ x: 2, y: 2 }]);
      end();
      expect([s().selectingRegion, s().regions.generator?.cells]).toEqual([false, [{ x: 2, y: 2 }]]);
    }
  });

  spec('UI-12', 'Delete acts on the newest state: under the map\'s menu or the delete question it reaches nothing on the map', () => {
    const { w, a, b } = open();
    s().setSelection([objectRef(a), objectRef(b)]);
    s().setContextMenu({ x: 0, y: 0, target: objectRef(a), mode: 'pc' });
    key('selection.delete');
    expect(w.state.objects.has(a.id) && w.state.objects.has(b.id)).toBe(true);
    escape();
    expect(s().contextMenu).toBeNull();
    s().setSelection([objectRef(a)]);
    key('selection.delete');
    expect(s().deletePopover).toEqual(objectRef(a));
    key('selection.delete');
    expect(w.state.objects.has(a.id)).toBe(true);
    escape();
    expect(s().deletePopover).toBeNull();
    expect(s().selection).toEqual([objectRef(a)]);
  });

  spec('UI-12', 'Delete passes over the assistant panel and the brush bar, which give it no meaning, to the selection under them', () => {
    const { a } = open();
    s().setEditMode({ mode: 'object' });
    s().setSelection([objectRef(a)]);
    s().setAssistantOpen(true);
    s().setObjectBrushBar(true);
    key('selection.delete');
    expect(s().deletePopover).toEqual(objectRef(a));
    expect([s().assistantOpen, s().objectBrushBar]).toEqual([true, true]);
  });

  spec('UI-21', 'What\'s this? is the newest state while it stands: one back-out ends it and nothing under it', () => {
    const { a } = open();
    s().setSelection([objectRef(a)]);
    s().setWhatsThis(true);
    escape();
    expect(s().whatsThis).toBe(false);
    expect(s().selection).toEqual([objectRef(a)]);
  });

  spec('BLUE-04', 'a frame step started in the unfolded explorer leaves with one Escape, and Delete in it deletes no blueprint', () => {
    open();
    s().setEditMode({ mode: 'blueprint' });
    unfoldBlueprintLibrary(true);
    beginBlueprintFrame(null, 'explorer');
    key('selection.delete');
    expect(s().blueprintStep.at).toBe('frame');
    escape();
    expect(s().blueprintStep).toMatchObject({ at: 'strip', reopening: true });
  });
});
