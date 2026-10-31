import { useCallback, useEffect, useState } from 'react';
import { fullscreenAvailable, isFullscreen, onFullscreenChange, toggleFullscreen } from '../../platform/device/fullscreen';
import { rememberImmersiveChoice } from '../../platform/device/installed-immersive';

/** The page's fullscreen state, live through the browser's own enter and exit. A toggle in an installed
 *  app is also the choice whether it enters on its own next time. */
export function useFullscreen(): { available: boolean; active: boolean; toggle: () => void } {
  const [active, setActive] = useState(isFullscreen);
  useEffect(() => onFullscreenChange(() => setActive(isFullscreen())), []);
  const toggle = useCallback(() => { rememberImmersiveChoice(!isFullscreen()); void toggleFullscreen(); }, []);
  return { available: fullscreenAvailable(), active, toggle };
}
