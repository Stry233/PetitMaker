/** An upright panel's seam handle held and dragged: the panel follows the finger past React. */
import { useLayoutEffect, useRef, useState } from 'react';
import { BAR_PANEL_DRAG_VAR } from './ShelfBand';

/**
 * `follow` takes a held handle's drag of `dy` visual px, or null as the hold ends: on each move the
 * `boxes` and the bar's band (`BAR_PANEL_DRAG_VAR`) take the live height, `kept(settled - dy / zoom)`
 * frame px, at once, and React hears only that the hold began and ended (`following`); as it ends the
 * boxes stand at `settled` again, which a release's new height then replaces in React's commit, and the
 * band's offset goes in that commit, or with the panel.
 * `onMove` hears each live height and `onEnd` the hold ending.
 */
export function useHandleFollow({ settled, kept, zoom, boxes, onMove, onEnd }: {
  settled: number;
  kept: (height: number) => number;
  zoom: number;
  boxes: () => readonly (HTMLElement | null)[];
  onMove?: (live: number) => void;
  onEnd?: () => void;
}): { following: boolean; follow: (dy: number | null) => void } {
  const [following, setFollowing] = useState(false);
  const followingNow = useRef(false);
  useLayoutEffect(() => {
    if (following) return () => { document.documentElement.style.removeProperty(BAR_PANEL_DRAG_VAR); };
  }, [following]);
  const follow = (dy: number | null) => {
    if (dy === null) {
      for (const el of boxes()) if (el) el.style.height = `${settled}px`;
      followingNow.current = false;
      setFollowing(false);
      onEnd?.();
      return;
    }
    if (!followingNow.current) { followingNow.current = true; setFollowing(true); }
    // Moves before React has committed the hold write nothing, so the panel's size is claimed as it
    // stood before the hold.
    if (!following) return;
    const live = kept(settled - dy / zoom);
    for (const el of boxes()) if (el) el.style.height = `${live}px`;
    document.documentElement.style.setProperty(BAR_PANEL_DRAG_VAR, `${live - settled}px`);
    onMove?.(live);
  };
  return { following, follow };
}
