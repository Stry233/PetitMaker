/**
 * A new object's id. Uniqueness is an INVARIANT: `state.objects` is keyed by id, so a repeat
 * replaces the object holding it, and the 2D layer keeps the old sprite (its sync only adds ids it
 * has never seen). The counter is what guarantees it within a session; the timestamp keeps those
 * ids clear of the ones in a map the session loads.
 */
let seq = 0;

/** A session-unique id after `prefix`: the timestamp, the session counter and a random tail. */
export function generateId(prefix: string): string {
  return prefix + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
}

export function generateObjectId(): string {
  return generateId('');
}
