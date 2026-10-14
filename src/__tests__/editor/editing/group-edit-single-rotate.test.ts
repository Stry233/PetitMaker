/**
 * `rotateObjectTo` reaches the single call path behind a single-object rotate: validate, execute,
 * play the spin on success, emit `validation-failed` on refusal. ContextMenu, SelectionCard and
 * the keyboard shortcut (editor/commands/commands.ts) all route through it rather than repeating the same
 * five-line sequence, so no caller can forget it or fire it on a doomed command.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { TerrainType, type PlacedObject } from '../../../core/model/types';
import { type EditorEvents } from '../../../state/editing/events';
import { makeState, setTerrain } from '../../_support/map-state';
import { rotateObjectTo } from '../../../editor/editing/group-edit';
import { getCatalogItem } from '../../../state/catalog';
import { createExecutor } from '../../../state/executor';
import { resetStore, setStoreState } from '../../_support/store';

// Rotatable, plain 'flat' trait only, and at least two cells wider than deep.
const HOUSE = 'building-myhouse';
const { width: W, height: H } = getCatalogItem(HOUSE)!;

function house(id: string, x: number, y: number): PlacedObject {
  return { id, catalogId: HOUSE, position: { x, y }, rotation: 0, elevation: 0 };
}

describe('rotateObjectTo (the shared single-object rotate call path)', () => {
  beforeEach(resetStore);

  it('rotates the object and plays the spin on a legal turn', () => {
    const state = makeState(30, 30);
    const obj = house('h1', 10, 10);
    state.objects.set(obj.id, obj);
    const bus = new EventBus<EditorEvents>();
    const executor = createExecutor(state, createDefaultRegistry(), bus);
    let refused: unknown;
    bus.on('validation-failed', (e) => { refused = e; });

    setStoreState({ gridState: state, commandExecutor: executor, eventBus: bus });
    expect(rotateObjectTo(obj, 90)).toBe(true);
    expect(state.objects.get('h1')?.rotation).toBe(90);
    expect(refused).toBeUndefined();
  });

  it('refuses a doomed rotation, leaves the object untouched, and emits validation-failed', () => {
    const state = makeState(30, 30);
    // Unrotated the flat-trait sweep reaches y<=10+H; rotated 90 it reaches y<=10+W, so a
    // raised strip at y=10+H+2 is outside the unrotated sweep but inside the rotated one, so
    // rotating alone flips this placement from legal to illegal (mirrors
    // object-placer-rotation.test.ts's ghost-preview case, exercised here on a placed object).
    const stripY = 10 + H + 2;
    expect(stripY).toBeLessThanOrEqual(10 + W);
    for (let x = 10; x <= 10 + H; x++) setTerrain(state, x, stripY, TerrainType.Mountain, 1);
    const obj = house('h1', 10, 10);
    state.objects.set(obj.id, obj);
    const bus = new EventBus<EditorEvents>();
    const executor = createExecutor(state, createDefaultRegistry(), bus);
    let refused: { cmd: unknown; errors: unknown } | undefined;
    bus.on('validation-failed', (e) => { refused = e as never; });

    setStoreState({ gridState: state, commandExecutor: executor, eventBus: bus });
    expect(rotateObjectTo(obj, 90)).toBe(false);
    expect(state.objects.get('h1')?.rotation).toBe(0);
    expect(refused).toBeDefined();
  });
});
