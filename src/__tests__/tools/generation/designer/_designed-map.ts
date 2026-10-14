// A designed map built the way the app builds one, and a memo so a test file that reads the same
// (seed, template, richness) in several tests generates it once. Vitest isolates modules per file,
// so a memo lives for one file's run.
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { ProvenanceRecorder } from '../../../../core/commands/provenance-recorder';
import { EventBus } from '../../../../core/commands/event-bus';
import { templateLandmarkObjects } from '../../../../core/model/landmarks';
import { createGridState } from '../../../../core/model/template';
import type { Command, GridState, MapTemplate, ValidationError } from '../../../../core/model/types';
import type { EditorEvents } from '../../../../state/editing/events';
import { createDefaultRegistry } from '../../../../rules/index';
import { generateDesigned, type DesignedOutcome } from '../../../../tools/generation/designer/pipeline';
import { terrainStrokePolicy } from '../../../../core/domain/edge-cut/stroke-policy';
import { applyTrim } from '../../../../core/domain/edge-cut/trim-apply';

export interface DesignedRun { state: GridState; outcome: DesignedOutcome; violations: ValidationError[] }

export interface DesignedOptions {
  richness?: number;
  maxElevation?: number;
  /** Set on the map before the run; omitted from the state when undefined. */
  ignoreChunkLoad?: boolean;
}

/** The template's own terrain and plaza, as a fresh planet holds them. */
export function freshMap(template: MapTemplate, ignoreChunkLoad?: boolean): GridState {
  const state: GridState = {
    template, cells: createGridState(template).cells, objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
    ...(ignoreChunkLoad !== undefined ? { ignoreChunkLoad } : {}),
  };
  const plaza = (templateLandmarkObjects(template)[0] ?? null);
  if (plaza) state.objects.set(plaza.id, plaza);
  return state;
}

/** One designed map on a fresh planet: one silent stroke from before the run, committed at the end,
 *  so the post-stroke rules judge everything the run placed. Always generates; use it for a map a test mutates
 *  or for determinism checks. */
export function buildDesigned(seed: number, template: MapTemplate, options: DesignedOptions = {}): DesignedRun {
  const state = freshMap(template, options.ignoreChunkLoad);
  const exec = new CommandExecutor(
    state,
    { bus: new EventBus<EditorEvents>(), rules: createDefaultRegistry(), policy: terrainStrokePolicy(() => null), provenance: new ProvenanceRecorder(state),
      trims: applyTrim },
  );
  let outcome: DesignedOutcome | undefined;
  const start = exec.beginStroke();
  exec.transaction({ silent: true }, () => {
    outcome = generateDesigned({
      state, execute: (c: Command) => exec.execute(c), reg: exec.getRegistry(),
      seed, richness: options.richness ?? 0.5,
      ...(options.maxElevation !== undefined ? { maxElevation: options.maxElevation } : {}),
    });
  });
  const violations = start.commit();
  return { state, outcome: outcome!, violations };
}

/**
 * `fn` answered once per distinct argument list. Templates key by id; every other argument by its
 * JSON. The cached value is shared, so a caller must not mutate it.
 */
export function memo<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const cache = new Map<string, R>();
  return (...args: A): R => {
    const key = JSON.stringify(args, (_, v: unknown) => (isTemplate(v) ? `template:${v.id}` : v));
    if (cache.has(key)) return cache.get(key)!;
    const value = fn(...args);
    cache.set(key, value);
    return value;
  };
}

function isTemplate(v: unknown): v is MapTemplate {
  return typeof v === 'object' && v !== null && 'id' in v && 'width' in v && 'height' in v && 'zones' in v;
}

/** `buildDesigned`, generated once per (seed, template, options) for the file. Read-only. */
export const designedMap = memo(buildDesigned);
