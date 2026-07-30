import type { GridState, Command, MacroCoord, ValidationResult } from '../../../core/model/types';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';
import type { GenConfig, ZonePlan } from '../types';
import { makeCtx, enforceClearance } from './object';
import { analyzeTerrain } from './analysis';
import { scanPortals } from './portals';
import { placeSettlement } from './settlement';
import { buildNetwork } from './network';
import { placeNature } from './nature';
import { getCatalogItem } from '../../../state/catalog';
import { isCoating } from '../../../core/model/traits';
import { edgeCutGeneratedRoads } from '../../edge-cut/auto-edge-cut';
import { generationCutMode } from '../style';

/** A cooperative cancel flag: the caller flips `cancelled` (e.g. when the user closes the panel) and the
 *  populator bails at its next yield point, leaving the partial work for the caller to roll back. */
export interface GenSignal { cancelled: boolean }

/** Yield to the event loop so the browser can paint (the loading spinner) and process input (a cancel)
 *  between the populator's heavy stages — a macrotask, not a microtask, so rendering actually happens. */
export const yieldFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Populate the just-generated terrain: distributed settlement nodes → region-portal road network →
 *  nature. Runs inside the Generate stroke group (caller commits). Rule-valid by construction. Cooperative:
 *  yields between stages so the UI stays responsive, and aborts early if `signal.cancelled` flips. */
export async function populate(config: GenConfig, state: GridState, execute: (c: Command) => ValidationResult, reg: RuleDispatcher, signal?: GenSignal, zonePlan?: ZonePlan): Promise<{ placed: number }> {
  const before = state.objects.size;
  const placed = () => ({ placed: state.objects.size - before });
  const ctx = makeCtx(state, execute, reg, config.seed, config.naturalness);
  // Yield (and check cancel) ONLY when a signal is supplied — the live app passes one for responsive,
  // cancellable generation. With no signal (headless callers) the awaits are skipped entirely, so populate
  // runs straight through synchronously and existing sync callers don't need to await it.
  const analysis = analyzeTerrain(state, config.region);
  if (signal) { await yieldFrame(); if (signal.cancelled) return placed(); }

  const { regionAdj } = scanPortals(ctx, analysis);
  if (signal) { await yieldFrame(); if (signal.cancelled) return placed(); }

  const { settled, nodes } = placeSettlement(ctx, analysis, config.settlement, regionAdj, zonePlan);
  if (signal) { await yieldFrame(); if (signal.cancelled) return placed(); }

  buildNetwork(ctx, analysis, config.settlement, nodes, regionAdj, zonePlan);
  if (signal) { await yieldFrame(); if (signal.cancelled) return placed(); }

  placeNature(ctx, analysis, config.nature, settled);
  enforceClearance(ctx); // guarantee gate/crossing clearance even against pre-clearance themed trees

  // Auto edge-cut the paved roads, mirroring the terrain pass in terrain-generator (same seed-picked
  // mode, so terrain and roads cut alike; 'off' in the rectilinear style). Region-scoped generation
  // only trims roads inside the region — roads elsewhere are the user's.
  const inRegion = config.region ? new Set(config.region.map((c) => `${c.x},${c.y}`)) : null;
  const roadCells: MacroCoord[] = [];
  for (const o of state.objects.values()) {
    const item = getCatalogItem(o.catalogId);
    if (!item || !isCoating(item)) continue;
    if (inRegion && !inRegion.has(`${o.position.x},${o.position.y}`)) continue;
    roadCells.push(o.position);
  }
  edgeCutGeneratedRoads({ gridState: state, executeCommand: execute }, roadCells, generationCutMode(config.seed, config.naturalness));
  return placed();
}
