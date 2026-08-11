/**
 * `rotateObjectAction` is the SINGLE call path behind a single-object rotate: validate, execute,
 * play the spin on success, emit `validation-failed` on refusal. ContextMenu, SelectionHandles and
 * the keyboard shortcut (kit/commands.ts) all route through it rather than repeating the same
 * five-line sequence — the deleted `ui/chrome/object-actions.ts:rotateObjectAction` held this once,
 * "so no caller can forget it or fire it on a doomed command".
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { TerrainType, type EditorEvents, type PlacedObject } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';
import { rotateObjectAction } from '../../kit/group-edit';
import { roadLookup } from '../../state/object-index';

// 7x4, rotatable, plain 'flat' trait only.
const HOUSE = 'building-myhouse';

function house(id: string, x: number, y: number): PlacedObject {
  return { id, catalogId: HOUSE, position: { x, y }, rotation: 0, elevation: 0 };
}

describe('rotateObjectAction (the shared single-object rotate call path)', () => {
  it('rotates the object and plays the spin on a legal turn', () => {
    const state = makeState(30, 30);
    const obj = house('h1', 10, 10);
    state.objects.set(obj.id, obj);
    const bus = new EventBus<EditorEvents>();
    const executor = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state));
    let refused: unknown;
    bus.on('validation-failed', (e) => { refused = e; });

    const result = rotateObjectAction(executor, state, bus, obj, 90, { from: 0, to: 90 });

    expect(result.ok).toBe(true);
    expect(state.objects.get('h1')?.rotation).toBe(90);
    expect(refused).toBeUndefined();
  });

  it('refuses a doomed rotation, leaves the object untouched, and emits validation-failed', () => {
    const state = makeState(30, 30);
    // Unrotated (7x4) the flat-trait sweep reaches y<=14; rotated 90 (4x7) it reaches y<=17 —
    // a raised strip at y=16 is outside the unrotated sweep but inside the rotated one, so
    // rotating alone flips this placement from legal to illegal (mirrors
    // object-placer-rotation.test.ts's ghost-preview case, exercised here on a PLACED object).
    for (let x = 10; x <= 14; x++) setTerrain(state, x, 16, TerrainType.Mountain, 1);
    const obj = house('h1', 10, 10);
    state.objects.set(obj.id, obj);
    const bus = new EventBus<EditorEvents>();
    const executor = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state));
    let refused: { cmd: unknown; errors: unknown } | undefined;
    bus.on('validation-failed', (e) => { refused = e as never; });

    const result = rotateObjectAction(executor, state, bus, obj, 90, { from: 0, to: 90 });

    expect(result.ok).toBe(false);
    expect(state.objects.get('h1')?.rotation).toBe(0);
    expect(refused).toBeDefined();
  });
});
