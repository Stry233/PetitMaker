import { useEffect, useState } from 'react';
import { fullscreenAvailable, isFullscreen, onFullscreenChange } from '../../platform/device/fullscreen';

/** The page's fullscreen state, live through the browser's own enter and exit. */
export function useFullscreen(): { available: boolean; active: boolean } {
  const [active, setActive] = useState(isFullscreen);
  useEffect(() => onFullscreenChange(() => setActive(isFullscreen())), []);
  return { available: fullscreenAvailable(), active };
}
