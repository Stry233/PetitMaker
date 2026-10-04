import { isTextEntry } from '../../core/runtime/text-entry';
/** Map gestures cancel native pointer focus changes, so text fields must release focus explicitly. */
export function releaseTextFocus(host: HTMLElement): void {
  const active = host.ownerDocument.activeElement;
  if (active instanceof HTMLElement && !host.contains(active) && isTextEntry(active)) active.blur();
}
