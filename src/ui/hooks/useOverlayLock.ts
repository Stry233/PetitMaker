import { useEffect } from 'react';
import { acquireOverlayLock } from '../../core/runtime/overlay-state';

/** While `open` is true, register a blocking overlay so global keyboard shortcuts (map pan/zoom,
 *  tool keys) suppress themselves — the map is a blurred background behind the popup. */
export function useOverlayLock(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    return acquireOverlayLock();
  }, [open]);
}
