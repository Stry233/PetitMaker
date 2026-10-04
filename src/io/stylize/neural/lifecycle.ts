import { createSignal } from '../../../core/runtime/signal';

let leases = 0;
const leasesChanged = createSignal();

export function retainNeuralRuntime(): () => void {
  leases++;
  leasesChanged.emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    leases--;
    leasesChanged.emit();
  };
}

export function hasNeuralConsumers(): boolean { return leases > 0; }
export function observeNeuralConsumers(listener: () => void): void { leasesChanged.subscribe(listener); }
