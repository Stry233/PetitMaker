import { encodeAutosave } from './autosave-codec';

export async function encodeAutosaveInWorker(json: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  return encodeAutosave(json);
}
