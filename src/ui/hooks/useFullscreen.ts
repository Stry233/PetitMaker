import { useCallback, useEffect, useState } from 'react';
import { fullscreenAvailable, isFullscreen, onFullscreenChange, toggleFullscreen } from '../../core/runtime/fullscreen';

/** The page's fullscreen state, live through the browser's own enter and exit. */
export function useFullscreen(): { available: boolean; active: boolean; toggle: () => void } {
  const [active, setActive] = useState(isFullscreen);
  useEffect(() => onFullscreenChange(() => setActive(isFullscreen())), []);
  const toggle = useCallback(() => { void toggleFullscreen(); }, []);
  return { available: fullscreenAvailable(), active, toggle };
}
