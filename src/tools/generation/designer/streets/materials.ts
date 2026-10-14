/**
 * Assigns each street its material, the dominant one with seeded accents, and reads the plan's road
 * cells.
 */
import { GENERATION_STYLE } from '../../../../config/generation-style';
import { flatIndex } from '../../../../core/grid/rect';
import { type Rng, shuffled } from '../../../../core/base/rng';
import { type Board, RANK_OF } from './board';
import { DOMINANT_SHARE, type RoadCell, type RoadRank, type StreetRun } from './model';

/** One dominant material with one or two accents, the way the built-in planets are paved: an accent goes
 *  on whole branch streets and only until the accent share reaches the calibrated one, so the spine
 *  of a map reads as one road. */
export function assignMaterials(
  board: Board, streets: readonly StreetRun[], rng: Rng, richness: number,
): { byStreet: (string | undefined)[]; accents: string[] } {
  const accentCount = 1 + (rng.float() < 0.3 + 0.4 * richness ? 1 : 0);
  const accents = shuffled(rng, GENERATION_STYLE.roads.accents).slice(0, accentCount);
  const byStreet = new Array<string | undefined>(streets.length).fill(undefined);
  const owned = new Int32Array(streets.length);
  let paved = 0;
  for (let i = 0; i < board.owner.length; i++) {
    const street = board.owner[i]!;
    if (street < 0 || !board.paved[i]) continue;
    owned[street] = owned[street]! + 1;
    paved++;
  }
  const target = Math.round((1 - DOMINANT_SHARE) * paved);
  // The branches first, then anything that is not the primary walk: a map whose branch grid came out
  // short would otherwise be paved in one material from end to end.
  const order = [
    ...shuffled(rng, streets.map((run, i) => ({ run, i })).filter(({ run }) => run.rank === 'branch').map(({ i }) => i)),
    ...shuffled(rng, streets.map((run, i) => ({ run, i })).filter(({ run }) => run.rank !== 'branch' && !run.primary).map(({ i }) => i)),
  ];
  let spent = 0;
  // A map whose streets are all too long for the accent budget would be paved in one material from
  // end to end; the smallest street takes the accent then, so the accent is kept at its floor rather
  // than abandoned.
  const fallback = order
    .filter((i) => owned[i]! > 0 && owned[i]! <= 2 * target)
    .sort((a, b) => owned[a]! - owned[b]!)[0];
  for (const i of order) {
    // A street takes an accent whole or not at all, and only while the accent share stays small: one
    // material carries 87 to 95% of a planet's pavement, so a street that would tip the map past that
    // is left in the dominant one.
    if (owned[i] === 0 || spent + owned[i]! > target) continue;
    byStreet[i] = accents[rng.int(accents.length)]!;
    spent += owned[i]!;
  }
  if (spent === 0 && fallback !== undefined) byStreet[fallback] = accents[0]!;
  return { byStreet, accents };
}

export function readCells(board: Board, byStreet: (string | undefined)[]): RoadCell[] {
  const out: RoadCell[] = [];
  for (let y = 0; y < board.H; y++) {
    for (let x = 0; x < board.W; x++) {
      const i = flatIndex(x, y, board.W);
      if (!board.paved[i]) continue;
      const street = board.owner[i]!;
      out.push({
        x, y,
        rank: RANK_OF[board.rankAt[i]!] as RoadRank,
        material: (street >= 0 ? byStreet[street] : undefined) ?? GENERATION_STYLE.roads.dominant,
      });
    }
  }
  return out;
}
