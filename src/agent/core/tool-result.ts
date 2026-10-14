/**
 * What a settled tool result says about the map, read from its structured fields only. The governor,
 * the panel projection and the helper rollup all classify results here, never from result prose.
 */
import type { ToolResultDetail } from './types';

type ResultFields = { write?: boolean; isError: boolean; detail?: ToolResultDetail };

/** Whether a write left edits on the map, including the retained part of a partial rollback. */
export function retainedWrite(result: ResultFields): boolean {
  if (!result.write || (result.detail?.reverted && !result.detail.partialRevert)) return false;
  const { cells, objects, partialRevert } = result.detail ?? {};
  if (cells !== undefined || objects !== undefined) return (cells ?? 0) + (objects ?? 0) > 0;
  return partialRevert === true || !result.isError;
}

/** How a result settled: rolled back by post-stroke rules, refused by the region lock, failed, or ok. */
type ResultStatus = 'revert' | 'blocked' | 'error' | 'ok';

export function resultStatus(result: Omit<ResultFields, 'write'>): ResultStatus {
  if (result.detail?.reverted) return 'revert';
  if (result.detail?.regionBlocked) return 'blocked';
  if (result.isError) return 'error';
  return 'ok';
}
