/*
 * The smart-build key, and the one thing a command may ask of the mounted control.
 *
 * WHAT the key toggles is the mounted surface's own — the terrain pill arms its first macro, the
 * object shelf's card arms the planting — and a command body holds no React state, so the mounted
 * control offers its own press here and the command calls whatever is offered.
 *
 * A press with nothing mounted does nothing, which is the honest answer rather than a missing one:
 * the actions on offer are a surface's, and with no surface on screen there is nothing to arm.
 */

let press: (() => void) | null = null;

/** The mounted cell offers its press. The returned function withdraws it, and only if this offer is
 *  still the standing one — two cells overlap for a frame when the surface changes, and a blind
 *  withdrawal from the one leaving would drop the offer the one arriving just made. */
export function offerSmartBuild(fn: () => void): () => void {
  press = fn;
  return () => { if (press === fn) press = null; };
}

/** Press the smart-build cell, if one is showing. */
export function pressSmartBuild(): void {
  press?.();
}
