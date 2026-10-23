/**
 * What the rule specs reach beyond the driver: one command as a tool issues it, several edits in one
 * stroke, the settings a person changes outside the map's commands (a layer lock, the load check),
 * the move verb, and the planet editor's world under its own rule set. Each is set the way the editor
 * sets it.
 */
import { paintTerrainCommand, placeObjectCommand } from '../../../core/model/command-build';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { createGridState } from '../../../core/model/template';
import type { Command, GridState, MacroCoord, PlacedObject, Rotation, TerrainType, ValidationError } from '../../../core/model/types';
import { groundZone, type GroundZone } from '../../../core/game/zones';
import type { CellZone } from '../../../core/game/profile';
import { getMapTemplate } from '../../../config/maps';
import { createPlanetRegistry } from '../../../rules/index';
import { getCatalogItem } from '../../../state/catalog';
import { createExecutor } from '../../../state/executor';
import { candidateObject, moveObject } from '../../../tools/objects';
import { groundCommand } from '../../../tools/placement/ground-command';
import type { CommandExecutor } from '../../../core/commands/command-executor';
import type { Outcome, SpecWorld } from '../_world';

const ruleIds = (errors: readonly ValidationError[]): string[] => [...new Set(errors.map((e) => e.ruleId))];

/** Whatever `act` does, with the rules that refused any of it, as the refusal toast hears them. */
function hearing(w: SpecWorld, act: () => readonly ValidationError[] | void): Outcome {
  const heard: ValidationError[] = [];
  const off = w.sandbox.bus.on('validation-failed', ({ errors }) => { heard.push(...errors); });
  try {
    heard.push(...(act() ?? []));
  } finally {
    off();
  }
  return { ok: heard.length === 0, refusedBy: ruleIds(heard) };
}

/** One command through the editor's executor, as the tool that builds it issues it. */
export function run(w: SpecWorld, cmd: Command): Outcome {
  const result = w.sandbox.execute(cmd);
  return { ok: result.success, refusedBy: ruleIds(result.errors) };
}

/** One stroke holding everything `act` does (paints, placements, removals), then the release that
 *  runs the end-of-stroke rules. */
export function inStroke(w: SpecWorld, act: () => unknown): Outcome {
  return hearing(w, () => {
    w.sandbox.beginStroke();
    act();
    return w.sandbox.commit();
  });
}

/** The live eraser's pass over `cells`, one peel per cell. */
export function peel(w: SpecWorld, cells: readonly MacroCoord[]): Outcome {
  return inStroke(w, () => { for (const c of cells) w.sandbox.peel(c, false); });
}

/** Lay out terrain as a person would, one stroke per step, failing the test if any step is refused. */
export function build(w: SpecWorld, ...steps: readonly [cells: readonly MacroCoord[], type: TerrainType, elevation: number][]): void {
  for (const [cells, type, elevation] of steps) {
    const outcome = w.stroke(cells, type, elevation);
    if (!outcome.ok) throw new Error(`arranging step at elevation ${elevation} was refused by ${outcome.refusedBy.join(', ')}`);
  }
}

/** Place `item` and fail the test if the map refuses it: arrangement, not the behaviour under test. */
export function placed(w: SpecWorld, item: string, x: number, y: number, opts: { rotation?: Rotation; elevation?: number } = {}): PlacedObject {
  const outcome = w.place(item, x, y, opts);
  if (!outcome.ok || !outcome.id) throw new Error(`arranging ${item} at ${x},${y} was refused by ${outcome.refusedBy.join(', ')}`);
  return w.object(outcome.id)!;
}

/** The first cell, row by row from the top, where `pred` holds. */
export function findCell(w: { state: GridState }, pred: (x: number, y: number) => boolean): MacroCoord {
  const { cells } = w.state;
  for (let y = 0; y < cells.length; y++) for (let x = 0; x < (cells[y]?.length ?? 0); x++) if (pred(x, y)) return { x, y };
  throw new Error('no such cell on this planet');
}

/** The ground a cell stands on, as the rules read it (a shore rim cell reads as the ground under it);
 *  null off the map. */
export function groundAt(w: { state: GridState }, x: number, y: number): CellZone | null {
  const cell = w.state.cells[y]?.[x];
  return cell ? groundZone(cell) : null;
}

export const setLayerLocked = (w: SpecWorld, elevation: number, locked: boolean): void => w.lockLayer(elevation, locked);

/** Switch the chunk load check, as the Settings switch does (`state/slices/engine.ts`). */
export function setLoadCheck(w: SpecWorld, enabled: boolean): void {
  w.state.ignoreChunkLoad = !enabled;
}

/** Drag `obj` so its anchor lands on (x, y), through the editor's move action. */
export function move(w: SpecWorld, obj: PlacedObject, x: number, y: number): Outcome {
  const result = moveObject(w.sandbox.executor, w.state, obj, x, y);
  return { ok: result.ok, refusedBy: ruleIds(result.refusal?.errors ?? []) };
}

/** Turn `obj` to `angle`, through the editor's rotate action. */
export function turn(w: SpecWorld, obj: PlacedObject, angle: Rotation): Outcome {
  const result = w.sandbox.rotateObject(obj, angle, { from: obj.rotation, to: angle });
  return { ok: result.ok, refusedBy: ruleIds(result.refusal?.errors ?? []) };
}

/**
 * The planet editor's world: a built-in planet under the planet session's rule set, where layer 0
 * is editable. The live session also re-derives the shore rim after each command; these specs edit
 * ground well inside the coast, where the rim never moves.
 */
export class PlanetWorld {
  readonly state: GridState;
  private readonly executor: CommandExecutor;
  private seq = 0;

  constructor(templateId?: string) {
    this.state = createGridState(getMapTemplate(templateId));
    this.executor = createExecutor(this.state, createPlanetRegistry());
  }

  /** Turn bare `cells` into `zone`, as the planet editor's ground brush does. */
  ground(cells: MacroCoord[], zone: GroundZone): Outcome {
    const result = this.executor.execute(groundCommand(cells, zone));
    return { ok: result.success, refusedBy: ruleIds(result.errors) };
  }

  /** One terrain brush stroke, released at the end. */
  stroke(cells: MacroCoord[], type: TerrainType, elevation: number): Outcome {
    const stroke = this.executor.beginStroke();
    const result = this.executor.execute(paintTerrainCommand(cells, type, elevation));
    const violations = stroke.commit();
    const errors = [...result.errors, ...violations];
    return { ok: errors.length === 0, refusedBy: ruleIds(errors) };
  }

  place(item: string, x: number, y: number): Outcome {
    const id = `planet-${item}-${this.seq++}`;
    const candidate = candidateObject(getCatalogItem(item)!, { x, y }, 0, this.state, { id });
    const result = this.executor.execute(placeObjectCommand(candidate));
    return result.success ? { ok: true, refusedBy: [], id } : { ok: false, refusedBy: ruleIds(result.errors) };
  }

  fingerprint(): string { return mapFingerprint(this.state); }
}
