import { useEffect } from 'react';
import type { InputMode } from '../../platform/device/input-mode';
import type { LayoutShape } from '../../platform/device/layout-shape';
import { useEditorStore } from '../../state/store';

/** The store's input mode, which the app root hands to `design/input-mode.tsx:InputModeProvider` and
 *  publishes as `<html data-input-mode>` for the style sheets (`design/animations.css`). Mount once. */
export function useInputMode(): InputMode {
  const mode = useEditorStore((s) => s.inputMode);
  useEffect(() => { document.documentElement.dataset.inputMode = mode; }, [mode]);
  return mode;
}

/** The store's layout shape, which the app root hands to the provider beside the input mode. */
export function useStoredLayoutShape(): LayoutShape {
  return useEditorStore((s) => s.layoutShape);
}
