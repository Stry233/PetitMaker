/**
 * What a click would select under the pointer, for a view whose interface draws the hover preview
 * in screen space (the 3D view). Macro coordinates; terrain cells render on the micro grid.
 */
import { createSignal } from '../core/runtime/signal';

interface HoverTarget { x: number; y: number; w: number; h: number; terrainMode: boolean }

const target = createSignal<HoverTarget | null>(null);

export function setHoverTarget(next: HoverTarget | null): void {
  const current = target.get();
  const same = current === next || (!!current && !!next
    && current.x === next.x && current.y === next.y && current.w === next.w && current.h === next.h && current.terrainMode === next.terrainMode);
  if (!same) target.emit(next);
}

export function hoverTarget(): HoverTarget | null {
  return target.get();
}

export function onHoverTargetChange(listener: () => void): () => void {
  return target.subscribe(listener);
}
