/** The first-launch tour as the shell runs it: the steps this device can show, and the mode and view each
 *  step asks for. The run gives back the view it borrowed as it ends (`state/slices/shell.ts:finishTour`). */
import { useCallback, useMemo } from 'react';
import { hasWebGL2 } from '../../../platform/device/device-quality';
import { useEditorStore } from '../../../state/store';
import type { TourStep } from '../../chrome/tour/steps';
import { shellTourSteps } from './tour-steps';

export function useShellTour() {
  const enterTourStep = useEditorStore((s) => s.enterTourStep);
  // Without WebGL2 the 3D steps are dropped.
  const steps = useMemo(() => shellTourSteps(hasWebGL2()), []);
  // Applied synchronously: the overlay measures the step's target in the frame after it enters.
  const onStepEnter = useCallback((step: TourStep) => enterTourStep(step), [enterTourStep]);
  return { steps, onStepEnter };
}
