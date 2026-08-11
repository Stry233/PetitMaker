/**
 * The rotate shortcut on a PLURAL selection: it used to route through `singleSelection`,
 * which returns null for a group, so the shortcut silently did nothing. It must instead run the
 * exact call path the SelectionHandles rotate button uses (`kit/group-edit.ts:rotateGroupAction`)
 * — same rigid-body turn, same refusal register — so the keyboard and the button can never diverge.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { COMMAND_BY_ID } from '../../kit/commands';
import { useEditorStore } from '../../state/store';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { registerCatalogItem } from '../../state/catalog';
import { CommandType, ItemCategory } from '../../core/model/types';
import type { EditorEvents, GridState, PlacedObject, ValidationError } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { roadLookup } from '../../state/object-index';

const noopCtx = { openBuild: () => {}, handleTileAction: () => {}, toggleMenu: () => {} };

registerCatalogItem({
  id: 'grs-hut', category: ItemCategory.Building, name: { en: 'grs-hut' },
  width: 1, height: 1, loadValue: 0, rotatable: true, placementMode: 'point', traits: [],
});
// Non-square, non-rotatable: the one shape rotateGroup refuses (a stand-in for a bridge/ramp span).
registerCatalogItem({
  id: 'grs-span', category: ItemCategory.Bridge, name: { en: 'grs-span' },
  width: 2, height: 1, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
});

interface Spec { id: string; catalogId: string; x: number; y: number }

function place(specs: Spec[]): { gs: GridState; exec: CommandExecutor; eventBus: EventBus<EditorEvents> } {
  const gs = makeState(24, 24);
  const eventBus = new EventBus<EditorEvents>();
  const exec = new CommandExecutor(gs, eventBus, createDefaultRegistry(), roadLookup(gs));
  for (const s of specs) {
    const object: PlacedObject = {
      id: s.id, catalogId: s.catalogId, position: { x: s.x, y: s.y },
      rotation: 0, elevation: 0,
    };
    const res = exec.execute({ type: CommandType.PlaceObject, timestamp: 0, object, loadValue: 0 });
    expect(res.success).toBe(true);
  }
  return { gs, exec, eventBus };
}

const snap = (gs: GridState, ids: string[]) => ids.map((id) => {
  const o = gs.objects.get(id)!;
  return { x: o.position.x, y: o.position.y, rotation: o.rotation };
});

afterEach(() => {
  useEditorStore.setState({ gridState: null, commandExecutor: null, selection: [] });
});

describe('selection.rotate_cw / selection.rotate_ccw on a plural selection', () => {
  it('turns the group as one rigid body, not a no-op', () => {
    const { gs, exec, eventBus } = place([
      { id: 'a', catalogId: 'grs-hut', x: 4, y: 4 },
      { id: 'b', catalogId: 'grs-hut', x: 5, y: 4 },
      { id: 'c', catalogId: 'grs-hut', x: 6, y: 4 },
    ]);
    useEditorStore.setState({
      gridState: gs, commandExecutor: exec, eventBus,
      selection: ['a', 'b', 'c'].map((id) => ({ kind: 'object', id }) as const),
    });
    COMMAND_BY_ID.get('selection.rotate_cw')!.run(noopCtx);
    // The row (constant y) became a column (constant x) — the same rigid-body turn `rotateGroup`
    // produces directly (see canvas/group-rotate.test.ts).
    const xs = ['a', 'b', 'c'].map((id) => gs.objects.get(id)!.position.x);
    const ys = ['a', 'b', 'c'].map((id) => gs.objects.get(id)!.position.y);
    expect(new Set(xs).size).toBe(1);
    expect(new Set(ys).size).toBe(3);
    expect(gs.objects.get('a')!.rotation).toBe(90);
  });

  it('the ccw key turns the opposite way', () => {
    const { gs, exec, eventBus } = place([
      { id: 'a', catalogId: 'grs-hut', x: 4, y: 4 },
      { id: 'b', catalogId: 'grs-hut', x: 6, y: 4 },
    ]);
    useEditorStore.setState({
      gridState: gs, commandExecutor: exec, eventBus,
      selection: ['a', 'b'].map((id) => ({ kind: 'object', id }) as const),
    });
    const before = snap(gs, ['a', 'b']);
    COMMAND_BY_ID.get('selection.rotate_ccw')!.run(noopCtx);
    COMMAND_BY_ID.get('selection.rotate_cw')!.run(noopCtx);
    // A ccw turn undone by a cw turn is the identity — proves ccw actually ran the opposite way,
    // not just "did nothing".
    expect(snap(gs, ['a', 'b'])).toEqual(before);
  });

  it('four cw taps return the group exactly home (rigid-body identity)', () => {
    const { gs, exec, eventBus } = place([
      { id: 'a', catalogId: 'grs-hut', x: 4, y: 4 },
      { id: 'b', catalogId: 'grs-hut', x: 6, y: 4 },
    ]);
    useEditorStore.setState({
      gridState: gs, commandExecutor: exec, eventBus,
      selection: ['a', 'b'].map((id) => ({ kind: 'object', id }) as const),
    });
    const before = snap(gs, ['a', 'b']);
    for (let i = 0; i < 4; i++) COMMAND_BY_ID.get('selection.rotate_cw')!.run(noopCtx);
    expect(snap(gs, ['a', 'b'])).toEqual(before);
  });

  it('a refusal (non-square, non-rotatable member) surfaces via validation-failed, same as the button', () => {
    const { gs, exec, eventBus } = place([
      { id: 'a', catalogId: 'grs-hut', x: 4, y: 4 },
      { id: 'span', catalogId: 'grs-span', x: 8, y: 4 },
    ]);
    useEditorStore.setState({
      gridState: gs, commandExecutor: exec, eventBus,
      selection: ['a', 'span'].map((id) => ({ kind: 'object', id }) as const),
    });
    const seen: ValidationError[] = [];
    eventBus.on('validation-failed', ({ errors }) => seen.push(...errors));
    COMMAND_BY_ID.get('selection.rotate_cw')!.run(noopCtx);
    expect(seen.some((e) => e.message === 'error.span_no_group_rotate')).toBe(true);
    // Nothing moved: the transform is all-or-nothing.
    expect(gs.objects.get('a')!.position).toEqual({ x: 4, y: 4 });
    expect(gs.objects.get('span')!.position).toEqual({ x: 8, y: 4 });
  });
});
