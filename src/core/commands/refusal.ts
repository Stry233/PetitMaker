import type { EditorEvents, Refusal } from '../model/types';
import type { EventBus } from './event-bus';

/** Surface `refusal` as `validation-failed`, which raises the toast and flashes the offending cells.
 *  A null refusal reports nothing. */
export function reportRefusal(bus: EventBus<EditorEvents>, refusal: Refusal | null | undefined): void {
  if (refusal) bus.emit('validation-failed', refusal);
}
