/**
 * Map repair: the repair every load runs (`landmark-clearance.ts`), which takes off what the current
 * rules refuse and plans where it could stand again, and the relocation planner and its landing
 * (`relocation-plan.ts`), which the hand repair also runs. Whether a map stands legally is the
 * rules' reading (`rules/legality.ts`).
 */
export { clearUnderLandmarks, type LandmarkClearance } from './landmark-clearance';
export { applyRelocation, planRelocation, type RelocationResult } from './relocation-plan';
