/*
 * surface-pose.ts — the pose a SURFACE owns, handed to the one live character.
 *
 * THE CHARACTER IS NOT IN THE TREE THAT KNOWS. `poseForPhase` answers from the session, and three of
 * the poses answer to something else entirely: the setup screen's own step (`keylean`, `pleased`) and
 * the map holding the pencil (`watching`). The surface that knows is inside
 * the panel's lazy chunk; the character lives in `CharacterHost`, one eager layer outside it, because
 * she stands in a seat of her own, over the panel rather than inside it. A prop cannot cross
 * that, so the fact is PUBLISHED here and read there.
 *
 * ONE WRITER AT A TIME, and it clears itself: a surface sets a pose while it stands and sets null
 * when it goes (its effect's own cleanup). The phase is what answers when nobody has published one,
 * which is the ordinary case.
 */
import { useSyncExternalStore } from 'react';
import type { PoseName } from './poses';

let current: PoseName | null = null;
const listeners = new Set<() => void>();

/** Publish the pose the standing surface calls for, or null to hand the character back to the
 *  phase. A no-op where nothing changes, so an effect may call it on every render. */
export function setSurfacePose(pose: PoseName | null): void {
  if (pose === current) return;
  current = pose;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** What a surface is asking for, or null. Server-rendered/first-paint answer is null: the phase's
 *  own reading is always a legal pose. */
export function useSurfacePose(): PoseName | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
