/**
 * What the harness needs to know about a tool without knowing any tool. The tool layer implements
 * this (`tools/registry.ts:TOOL_FACTS`) and the executor, the loop and the projection receive it, so
 * core code never names a tool it gates, counts or draws.
 */
import type { ToolAccess } from './types';

/** A box of map cells: its top-left cell and its size in cells. */
export interface CellBox { origin: { x: number; y: number }; width: number; height: number }

/** The tools the loop's own advice points the model to, by what each offers. */
export interface GuideTools {
  /** Reads one area of the map closely. */
  inspect: string;
  /** Pictures the map, or a part of it. */
  view: string;
  /** Scores the whole map. */
  score: string;
  /** Loads a build technique. */
  skill: string;
  /** The search family, written as its wildcard (`find_*`). */
  search: string;
}

export interface ToolFacts {
  /** What the named tool may do to the map, or undefined for a name no tool has. */
  access(name: string): ToolAccess | undefined;
  /** Whether a successful call of the named tool is a look at the map that reviews prior edits. */
  verifies(name: string): boolean;
  /** The cells a call's arguments name, as their bounding box, where they name a place. */
  footprint(input: Record<string, unknown>): CellBox | undefined;
  /** The tools the nudges name, so core prose names no tool itself. */
  guides: GuideTools;
}

/** Whether the named tool edits the map: the approval gate and the edit counters read this. */
export function writesMap(facts: Pick<ToolFacts, 'access'>, name: string): boolean {
  const access = facts.access(name);
  return access === 'write' || access === 'wide';
}
