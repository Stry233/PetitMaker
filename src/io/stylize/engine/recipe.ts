// What one generation call DOES, resolved from a dialect's own capabilities rather than hand-set
// per direction: a style swatch or the layout legend only ever ride along when the dialect can
// carry the extra image, and a critique-retry only where the dialect can judge at all.
import type { StylizeDialect } from '../dialects/types';

export interface Recipe {
  /** style needs a swatch asset AND maxImages >= 2; layout additionally needs the flag below. The
   *  actual image set assembled at generation time may still drop one of these to fit the
   *  dialect's real budget (style first) — this is the CAPABILITY, not the final call shape. */
  conditions: { style: boolean; layout: boolean };
  /** One critique + one re-anchored retry, never chained. Product default false. */
  judge: boolean;
}

/** The experimental layout condition ships OFF until the tuning rig proves it: one constant, one
 *  place, so the decision reads as a single line rather than a scatter of dialect checks. */
export const LAYOUT_CONDITION_ENABLED = false;

export function resolveRecipe(dialect: StylizeDialect, opts?: { judge?: boolean }): Recipe {
  return {
    conditions: {
      style: dialect.maxImages >= 2,
      layout: LAYOUT_CONDITION_ENABLED && dialect.maxImages >= 2,
    },
    judge: !!opts?.judge && dialect.canJudge,
  };
}
