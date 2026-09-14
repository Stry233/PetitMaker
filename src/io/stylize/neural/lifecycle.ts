let leases = 0;
const listeners = new Set<() => void>();

export function retainNeuralRuntime(): () => void {
  leases++;
  for (const listener of listeners) listener();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    leases--;
    for (const listener of listeners) listener();
  };
}

export function hasNeuralConsumers(): boolean { return leases > 0; }
export function observeNeuralConsumers(listener: () => void): void { listeners.add(listener); }
