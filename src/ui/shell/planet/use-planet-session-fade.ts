import { useEffect } from 'react';
import { useEditorStore } from '../../../state/store';

/**
 * Runs `begin` as a planet session opens or closes. The store notifies synchronously, inside the
 * same call that swaps the map, so the fade's hide lands in the render that shows the new map.
 */
export function usePlanetSessionFade(begin: () => void): void {
  useEffect(() => useEditorStore.subscribe((state, prev) => {
    if (!state.planetSession !== !prev.planetSession) begin();
  }), [begin]);
}
