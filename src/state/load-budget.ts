import { exceedsLoadBudget, isChunkLoadEnforced, roundLoad } from '../core/model/load';
import type { GridState, PlacedObject } from '../core/model/types';
import { catalogLoadValue } from './catalog';
import { chunksOf, getMapStats } from './map-stats';

/** A detached load ledger for planning whole layouts before issuing placement commands. */
export class LoadBudget {
  private readonly base: Map<string, number>;
  private readonly changes = new Map<string, number>();

  constructor(private readonly state: GridState) {
    this.base = new Map([...getMapStats(state).chunks].map(([key, value]) => [key, value.load]));
  }

  change(object: PlacedObject, sign: 1 | -1): void {
    if (object.patchOnly) return;
    const cost = sign * catalogLoadValue(object.catalogId);
    for (const key of chunksOf(object, this.state.template)) {
      this.changes.set(key, roundLoad((this.changes.get(key) ?? 0) + cost));
    }
  }

  get fits(): boolean {
    return !isChunkLoadEnforced(this.state) || [...this.changes].every(([key, change]) => !exceedsLoadBudget(this.base.get(key) ?? 0, change));
  }

}
