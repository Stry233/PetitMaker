/** The offline edition starts no workers, so a demo builds its worlds on the main thread. */
export const buildInWorker: typeof import('./scene-world-builder').buildInWorker = async () => null;
