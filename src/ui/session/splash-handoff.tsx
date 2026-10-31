/**
 * The boot splash's hand-off, as the surfaces under it see it: while the splash covers the app, the
 * app's plane stands lowered, and as the splash lifts away the plane rises its last stretch into place
 * on the splash's clock. A surface portalled to the body stands outside that plane, so one open across
 * the hand-off (the welcome tips) wears the same shift to rise with it.
 */
import { createContext, useContext, type CSSProperties } from 'react';
import { cssMotion } from '../design/motion';

/** No splash, the splash covering the app, or the splash lifting away. */
export type HandoffStage = 'none' | 'covered' | 'leaving';

/** How far below its place the app waits under the splash. `vh` because the plane is the viewport. */
const LOWERED = 'translateY(4vh)';

/** The shift a surface wears at `stage`; none at all once the splash is gone, since even an identity
 *  transform makes a containing block for fixed descendants. */
export function handoffShift(stage: HandoffStage): CSSProperties | undefined {
  if (stage === 'none') return undefined;
  return stage === 'leaving'
    ? { transform: 'translateY(0)', transition: cssMotion('splash.handoff', ['transform']) }
    : { transform: LOWERED, transition: 'none' };
}

const Stage = createContext<HandoffStage>('none');

/** Published once by the editor root, around everything the splash covers. */
export const HandoffStageProvider = Stage.Provider;

/** The hand-off shift for a body-portalled surface, or undefined outside a hand-off. */
export function useHandoffShift(): CSSProperties | undefined {
  return handoffShift(useContext(Stage));
}

/** Whether the splash still hides what stands under it; it shows from the moment the splash starts lifting. */
export function useHandoffCovered(): boolean {
  return useContext(Stage) === 'covered';
}
