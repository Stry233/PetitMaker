/**
 * Same-seed comparison, minus the fields that are never seed-derived: object ids
 * (`generateObjectId` mixes in `Date.now()`/`Math.random()` by design, since an id must be unique
 * across runs, not reproducible) and the save's own wall-clock stamp.
 *
 * A plain module, not a `.test.ts` — importing a test file re-runs its `describe`/`it` blocks
 * during collection (they execute as a side effect of the import), which is what `_pixi-env.ts`
 * sidesteps the same way for the canvas suite.
 */
import { serialize } from '../../io/json-codec';

export function stableSerialize(state: Parameters<typeof serialize>[0]): string {
  const parsed = JSON.parse(serialize(state));
  delete parsed.metadata;
  for (const obj of parsed.objects) delete obj.id;
  if (parsed.provenance) {
    for (const op of parsed.provenance.ledger) { delete op.timestamp; delete op.scope?.objectIds; }
    for (const entry of parsed.provenance.objects) delete entry.id;
  }
  return JSON.stringify(parsed);
}
