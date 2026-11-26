import type { PlanetSession } from './slices/planet-session';

/** What the frame is reduced to: the whole map editor, a planet session's, or a hand repair's, whose
 *  row offers no modes (`editing/edit-mode.ts:modesInSession`, where a hand repair wins too). */
export type FramePose = 'map' | 'planet' | 'repair';

type Sessions = { readonly planetSession: PlanetSession | null; readonly repairSession: { readonly phase: string } | null };

export function framePose(s: Sessions): FramePose {
  if (s.repairSession?.phase === 'hand') return 'repair';
  return s.planetSession !== null ? 'planet' : 'map';
}

/** Whether the map is held: a planet is being edited on the canvas in its place, or a repair is in
 *  its hand phase. Nothing replaces a held map (a file, another planet, a new map), since the map
 *  that was open waits behind it for the session to end. */
export function mapHeld(s: Sessions): boolean {
  return framePose(s) !== 'map';
}
