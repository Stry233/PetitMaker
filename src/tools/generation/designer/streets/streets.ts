/**
 * Stage B partitions terrace plates with seeded straight streets. A street skeleton is dilated by
 * its rank width only where the full stamp is paveable; unreachable fragments are pruned. Inline
 * ramp flights reconnect street segments across tiers, while entry flights serve otherwise isolated
 * districts. The plan is pure and deterministic and is committed by later stages.
 */
import { GENERATION_STYLE } from '../../../../config/generation-style';
import { makeRng, mix } from '../../../../core/base/rng';
import { clamp01, lerpClamped } from '../../../../core/base/math';
import type { DesignInput } from '../types';
import type { CompositionPlan } from '../composition/composition';
import type { MovementLine } from '../composition/movement-line';
import { cutDistricts } from './blocks';
import { makeBoard } from './board';
import { planCrossings } from './crossings';
import { holdSteps, hubDescent, pickStyles, planEndFlights, planEntries, planFlights, planOpportunities, spentOn } from './flights';
import { layStreets } from './lines';
import { assignMaterials, readCells } from './materials';
import type { StreetPlan } from './model';
import { settle } from './settle';

/** Ramps a map may carry, at richness 0 and 1. A terraced planet carries about fifty and a flat one
 *  none, so the budget spans the two; the spanning construction usually spends far less. */
const RAMP_BUDGET = { low: 8, high: 44 } as const;

/** How many places the movement line may step over water, at richness 0 and 1. A planet carries a
 *  handful of bridges, and a walk that crosses more than a couple of channels is a causeway. */
const CROSSING_COUNT = { low: 1, high: 3 } as const;

// --- entry point -------------------------------------------------------------------------------

/** The street layer of one map: the lines, the pavement they lay, the flights that carry them over
 *  the composition's tier steps, and the districts the two of them cut the planet into. */
export function planStreets(
  { seed, template, composition, richness, line }: DesignInput & { composition: CompositionPlan; line?: MovementLine },
): StreetPlan {
  const r = clamp01(richness);
  // Avalanche neighboring seeds before sampling flight geometry and appearance.
  const rng = makeRng(mix(seed, 0x2b7e1516));
  const board = makeBoard(template, composition);

  const laid = layStreets(board, composition, r, seed, line);
  // Draw the flight salt before catalog shuffling so new styles cannot advance its random stream.
  const salt = rng.int(0x7fffffff);
  const styles = pickStyles(rng);
  const budget = Math.round(lerpClamped(RAMP_BUDGET.low, RAMP_BUDGET.high, r)) + hubDescent(board, laid);
  const inline = planFlights(board, laid, styles, salt, budget);
  const held = holdSteps(board, laid);
  // The blocks an entry flight is for are the ones the finished network leaves shut, so the streets
  // are settled once before they are looked for: a street that the pruning is about to take back
  // would otherwise read as the access a block already has.
  const settled = settle(board, laid, inline);
  const spent = inline.reduce((n, f) => n + f.ramps.length, 0);
  const entries = planEntries(board, settled.streets, composition, budget - spent, { styles, salt });
  const withEntries = settle(board, settled.streets, [...settled.flights, ...entries]);
  for (const i of held) if (!board.reserved[i]) board.stopAt[i] = 0;
  const opportunity = planOpportunities(
    board, withEntries.streets, styles, salt,
    budget - withEntries.flights.reduce((n, f) => n + f.ramps.length, 0),
  );
  let { streets, flights } = settle(board, withEntries.streets, [...withEntries.flights, ...opportunity]);
  // The end of a street is a way on or it is a dead end. What is left after the growth is a stretch of
  // pavement that runs up to a terrace step and stops, which the arrival ledger reads as a street
  // ending at nothing — rightly, since a walker meeting a cliff has arrived nowhere. A flight there
  // is both the way on and the arrival.
  const ends = planEndFlights(board, streets, styles, salt, budget - spentOn(flights));
  if (ends.length > 0) ({ streets, flights } = settle(board, streets, [...flights, ...ends]));
  // The crossings come last, on the pavement the settling actually left: a channel is only cut where
  // the two banks stay joined to the plaza without it, so a deck that fails to land costs the map a
  // bridge rather than a network.
  const crossings = planCrossings(
    board, streets, flights, Math.round(lerpClamped(CROSSING_COUNT.low, CROSSING_COUNT.high, r)),
  );
  // Settled one last time, whatever the channels did. Every pass above can leave pavement the plaza
  // cannot walk to — a channel cut across a street, a bend whose two legs the ground refused, a
  // flight retired — and the settling is the only thing that takes it back, so it runs whether or not
  // a crossing landed.
  ({ streets, flights } = settle(board, streets, flights));
  const materials = assignMaterials(board, streets, rng, r);
  const districts = cutDistricts(board, composition);

  return {
    seedInfo: { seed, richness: r, templateId: template.id },
    streets,
    cells: readCells(board, materials.byStreet),
    ramps: flights.flatMap((f) => f.ramps),
    flights,
    districts,
    materials: { dominant: GENERATION_STYLE.roads.dominant, accents: materials.accents },
    unserved: districts.filter((d) => !d.served).map((d) => d.id),
    crossings,
  };
}
