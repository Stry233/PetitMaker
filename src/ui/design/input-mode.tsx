/**
 * The device facts the interface sizes and arranges itself by, provided once at the app root from
 * the store (`ui/app/EditorRoot.tsx`), so design hooks and primitives read them without the store.
 */
import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react';
import type { InputMode } from '../../platform/device/input-mode';
import type { LayoutShape } from '../../platform/device/layout-shape';
import { interactionProfilesFor, type InteractionProfiles } from './styles';
import { landUiZoom } from './ui-zoom-anim';
import { createSignal } from '../../core/base/signal';

interface DeviceFacts {
  inputMode: InputMode;
  shape: LayoutShape;
}

/** A subtree mounted outside the app root (its own React root, a test) is in PC mode. */
const DeviceFactsContext = createContext<DeviceFacts>({ inputMode: 'pc', shape: 'landscape' });

/** Whether the sizes stand at touch mode, for a writer outside a render (`scale.tsx:liveScaleNow`);
 *  renders read the settled mode (`useTouchMode`). It steps with the mode, in the commit that switches
 *  it; the chrome's morph carries the re-size on screen (`shell/ChromeMorph.tsx`). */
export const touchSizing = createSignal<boolean>(false);

/** The sizing and the UI zoom the mode or the arrangement brings (`ui-zoom-anim.ts:landUiZoom`) step to
 *  it in the commit that switches it, after the chrome's morph has measured where its pieces stood. The
 *  mode itself switches only once the last pointer lifts, so the re-size never moves under a finger. */
function useTouchSizingSeat(inputMode: InputMode, shape: LayoutShape): void {
  const touch = inputMode === 'touch';
  useLayoutEffect(() => {
    if (touchSizing.get() !== touch) touchSizing.emit(touch);
    landUiZoom();
  }, [touch, shape]);
}

export function InputModeProvider({ inputMode, shape = 'landscape', children }: { inputMode: InputMode; shape?: LayoutShape; children: ReactNode }) {
  const value = useMemo<DeviceFacts>(() => ({ inputMode, shape }), [inputMode, shape]);
  useTouchSizingSeat(inputMode, shape);
  return <DeviceFactsContext.Provider value={value}>{children}</DeviceFactsContext.Provider>;
}

/** Whether the interface is in its touch mode. */
export function useTouchMode(): boolean {
  return useContext(DeviceFactsContext).inputMode === 'touch';
}

/** Whether the interface takes its portrait or its landscape arrangement. */
export function useLayoutShape(): LayoutShape {
  return useContext(DeviceFactsContext).shape;
}

/** The interaction profiles for the live input mode (`styles.ts:interactionProfilesFor`). */
export function useInteractionProfiles(): InteractionProfiles {
  return interactionProfilesFor(useContext(DeviceFactsContext).inputMode);
}

/** `hover` in PC mode, nothing in touch mode, where nothing hovers: a hover pose, growth or state. */
export function useHover<T>(hover: T): T | undefined {
  return useContext(DeviceFactsContext).inputMode === 'touch' ? undefined : hover;
}

/** The live input mode itself, for a surface that hands it on or chooses by it. */
export function useCurrentInputMode(): InputMode {
  return useContext(DeviceFactsContext).inputMode;
}
