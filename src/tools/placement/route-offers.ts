/**
 * UP TO THREE GENUINELY DIFFERENT ROUTES, or fewer, honestly.
 *
 * One A* over three cost profiles: straight (turning is expensive, so it commits to long runs),
 * short (road reuse with a moderate bend cost, the default offer), scenic (a discount for hugging
 * water and terrace edges, so the walk has something to look at). Three profiles do not guarantee
 * three ANSWERS: across open ground they collapse onto the same line, and offering the same route
 * three times with three names is the kind of variety this design exists to stop pretending to.
 * So near-identical offers COLLAPSE, and the caller sometimes has one offer and no cycle
 * affordance, which is the truth about that pair of taps.
 */
import type { MacroCoord } from '../../core/model/types';
import { planRoute, type RoutePlan, type RouteProfile, type RouteWorld } from './route';

export interface RouteOffer {
  plan: RoutePlan;
  profile: RouteProfile;
}

/** The order offers are drafted and shown in. Deterministic, and `short` is FIRST because the
 *  map's own style is the offer that needs no explanation; the other two are alternatives to it. */
export const OFFER_ORDER: readonly RouteProfile[] = ['short', 'straight', 'scenic'];

/** Two offers are the same offer when their cell sets differ by less than this fraction
 *  (Jaccard distance). A one-cell jog is not a different way to go. */
export const OFFER_SAME = 0.12;

const cellKey = (c: MacroCoord): string => `${c.x},${c.y}`;

export function sameRoute(a: RoutePlan, b: RoutePlan): boolean {
  const setA = new Set(a.cells.map(cellKey));
  const setB = new Set(b.cells.map(cellKey));
  let intersection = 0;
  for (const key of setA) if (setB.has(key)) intersection++;
  const union = setA.size + setB.size - intersection;
  if (union === 0) return true; // both empty — nothing to tell apart
  return 1 - intersection / union < OFFER_SAME;
}

/** Every distinct offer, in `OFFER_ORDER`, earlier absorbing later. Empty when no route exists. */
export function routeOffers(world: RouteWorld, from: MacroCoord, to: MacroCoord): RouteOffer[] {
  const offers: RouteOffer[] = [];
  for (const profile of OFFER_ORDER) {
    const plan = planRoute(world, from, to, profile);
    if (!plan) continue;
    if (offers.some((offer) => sameRoute(offer.plan, plan))) continue;
    offers.push({ plan, profile });
  }
  return offers;
}
