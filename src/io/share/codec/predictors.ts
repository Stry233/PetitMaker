// src/io/share/codec/predictors.ts — predictor bank for petitglyph-v2 codec. Provides two
// "predictors" (reference maps): an empty template, and a deterministic generator replay.
// The payload codec will choose which predictor minimizes residual bits. Both are pure
// (no DOM/canvas), so this runs in node and the browser identically.
import type { CanonicalSave } from '../canonical';
import { canonicalize } from '../canonical';
import { getMapTemplate } from '../../../config/maps';
import { createGrid, createPlazaObject } from '../../../core/model/grid-model';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { generateTerrain } from '../../../tools/generation/terrain-generator';
import { toGenConfig } from '../../../tools/generation';
import { populate } from '../../../tools/generation/placement';
import type { Command, EditorEvents, GenerateConfig, GridState, PlacedObject } from '../../../core/model/types';

export const P_EMPTY = 0;
export const P_REPLAY = 1;

/** A fresh, empty state for a template — mirrors the store's initMap (grid + locked plaza). */
export function createBlankGridState(templateId: string): GridState {
  const template = getMapTemplate(templateId);
  const cells = createGrid(template);
  const objects = new Map<string, PlacedObject>();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells, objects, lockedLayers: new Set() };
}

/** Empty template as a canonical map (no objects). */
export function emptyCanonical(templateId: string): CanonicalSave {
  return canonicalize(createBlankGridState(templateId));
}

/** The replay is deterministic per (templateId, config) and costs a full generation run;
 *  one share-code build asks for it twice (encode + self-verify) and the export dialog
 *  rebuilds per debounced input change. A tiny cache turns all of that into one run. */
const REPLAY_CACHE_MAX = 4;
const replayCache = new Map<string, CanonicalSave>();

/** Replay the generator deterministically and return the canonical map. Mirrors the live Generate
 *  path (generateTerrain → populate for 'random', then commitStrokeGroup). The returned canonical
 *  save is shared across callers and must be treated as read-only. */
export async function replayCanonical(templateId: string, config: GenerateConfig): Promise<CanonicalSave> {
  const cacheKey = `${templateId}|${JSON.stringify(config)}`;
  const hit = replayCache.get(cacheKey);
  if (hit) return hit;
  const state = createBlankGridState(templateId);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  await exec.runSilentlyAsync(async () => {
    const r = generateTerrain(config, state, (c: Command) => exec.execute(c));
    if (config.algorithm === 'random') {
      await populate(toGenConfig(config), state, (c: Command) => exec.execute(c), exec.getRegistry(), undefined, r.zonePlan);
    }
  });
  exec.commitStrokeGroup(0);
  const canon = canonicalize(state);
  if (replayCache.size >= REPLAY_CACHE_MAX) {
    const oldest = replayCache.keys().next().value;
    if (oldest !== undefined) replayCache.delete(oldest);
  }
  replayCache.set(cacheKey, canon);
  return canon;
}
