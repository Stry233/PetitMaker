import { encodeRecord } from './record-codec';
import { throwIfAborted } from '../../platform/async/abort';

export async function encodeRecordInWorker(json: string, signal: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  return encodeRecord(json);
}
