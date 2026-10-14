import { useState } from 'react';
import type { RepairAct } from '../derive/repair';

type StorageNotice = 'pruned' | 'lost' | 'corrupt' | null | undefined;

/**
 * The storage notice's own answers. Lost and pruned notices demote locally until the store clears
 * them, which re-arms a later one of the same class; dismissing a corrupt notice discards its bytes.
 */
export function useStorageNotice(notice: StorageNotice, onDiscard: (() => void) | undefined, onRepair: ((act: RepairAct) => void) | undefined): {
  standing: boolean;
  onAction(act: RepairAct): void;
} {
  const [demoted, setDemoted] = useState<'pruned' | 'lost' | null>(null);
  const [seen, setSeen] = useState(notice);
  if (seen !== notice) {
    setSeen(notice);
    if (notice !== 'lost' && notice !== 'pruned') setDemoted(null);
  }
  return {
    standing: (notice === 'lost' || notice === 'pruned') && demoted === notice,
    onAction: (act) => {
      if (act !== 'dismiss') { onRepair?.(act); return; }
      if (notice === 'corrupt') onDiscard?.();
      else if (notice === 'lost' || notice === 'pruned') setDemoted(notice);
    },
  };
}
