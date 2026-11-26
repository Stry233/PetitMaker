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
  /** Reads the planning annotations back. */
  sketch: string;
  /** Hands one region to a helper. */
  helper: string;
}

/** The approval a call needs: none, an ordinary write's (asked under strict oversight) or a wide
 *  call's (asked under checkpoint oversight too). */
export type GateLevel = 'none' | 'write' | 'wide';

export interface ToolFacts {
  /** What the named tool may do to the map, or undefined for a name no tool has. */
  access(name: string): ToolAccess | undefined;
  /** Whether a successful call of the named tool is a look at the map that reviews prior edits. */
  verifies(name: string): boolean;
  /** Whether the named tool draws planning annotations, the plan the plan protocol files. */
  sketches(name: string): boolean;
  /** Whether a successful call of the named tool delivers what a job was asked without editing the
   *  map, as an app action does. */
  delivers(name: string): boolean;
  /** The cells a call's arguments name, as their bounding box, where they name a place. */
  footprint(input: Record<string, unknown>): CellBox | undefined;
  /** The approval this call needs where its arguments decide it; absent or undefined, the tool's
   *  access decides (`gateLevelOf`). */
  gateLevel?(name: string, input: Record<string, unknown>): GateLevel | undefined;
  /** The tools the nudges name, so core prose names no tool itself. */
  guides: GuideTools;
}

/** The approval a call needs: what its tool answers for these arguments, else what its access to
 *  the map implies. A call may need approval without editing the map, so the edit counters read
 *  `writesMap`, never this. */
export function gateLevelOf(facts: Pick<ToolFacts, 'access' | 'gateLevel'>, name: string, input: Record<string, unknown>): GateLevel {
  const own = facts.gateLevel?.(name, input);
  if (own !== undefined) return own;
  const access = facts.access(name);
  return access === 'write' || access === 'wide' ? access : 'none';
}

/** Whether the named tool edits the map: the edit counters, the undo floor and the result stamps read this. */
export function writesMap(facts: Pick<ToolFacts, 'access'>, name: string): boolean {
  const access = facts.access(name);
  return access === 'write' || access === 'wide';
}
