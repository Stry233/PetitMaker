/** The page's device detectors written into the store, and the map's touch gestures that run an
 *  editor command, installed once by `install.ts:prepareEditor`. */
import { watchInputMode } from '../../platform/device/input-mode';
import { watchLayoutShape } from '../../platform/device/layout-shape';
import { useEditorStore } from '../../state/store';
import { setTwoFingerTapHandler } from '../../view/interaction/pointer/gesture-channel';
import { RUN } from '../commands/commands';

/** Undo needs no shell: its body never opens the menu. */
const NO_SHELL = { toggleMenu: () => {} };

/** Mirrors the live input mode and layout shape into the store, and makes a two-finger tap on the
 *  map undo as the undo key does; returns the stop. Each detector starts from the store's value, the
 *  one read of the device at startup, so the store and the detector cannot disagree. */
export function installDeviceWiring(): () => void {
  const { inputMode, layoutShape, setInputMode, setLayoutShape } = useEditorStore.getState();
  const stopMode = watchInputMode(setInputMode, inputMode);
  const stopShape = watchLayoutShape(setLayoutShape, layoutShape);
  setTwoFingerTapHandler(() => RUN['history.undo'](NO_SHELL));
  return () => {
    stopMode();
    stopShape();
    setTwoFingerTapHandler(null);
  };
}
