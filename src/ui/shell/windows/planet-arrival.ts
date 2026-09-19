import type { Arrival, ArrivalLine } from '../../../core/runtime/arrival-bus';
import type { TransferCounts } from '../../../kit/operations';

const CAME_ALONG: ArrivalLine = { key: 'arrival.transferred' };

/** Terrain cells and objects use separate counts and translated labels. */
export function transferLines(dropped: TransferCounts): readonly ArrivalLine[] {
  const { cells, objects } = dropped;
  if (cells > 0 && objects > 0) return [CAME_ALONG, { key: 'arrival.transferred_both', params: { cells, objects } }];
  if (cells > 0) return [CAME_ALONG, { key: 'arrival.transferred_ground', params: { cells } }];
  if (objects > 0) return [CAME_ALONG, { key: 'arrival.transferred_pieces', params: { objects } }];
  return [CAME_ALONG];
}

const NOTHING_ARRIVED: readonly ArrivalLine[] = [
  { key: 'arrival.transferred_lost' },
  { key: 'arrival.transferred_lost_none' },
];

export function transferArrival(outcome: { moved: TransferCounts; dropped: TransferCounts }): Arrival {
  const { moved, dropped } = outcome;
  if (moved.cells + moved.objects > 0) return { kind: 'transferred', detail: transferLines(dropped) };
  if (dropped.cells + dropped.objects > 0) return { kind: 'transferred', detail: NOTHING_ARRIVED };
  return { kind: 'boot' };
}
