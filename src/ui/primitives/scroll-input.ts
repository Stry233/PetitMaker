import { followToward, frameDt } from '../design/motion';

interface WheelInput { deltaX: number; deltaY: number; deltaMode: number; ctrlKey?: boolean }
interface WheelPush { by: number }
const WHEEL_LINE = 40;

/** Wheel deltas are visual pixels; scrollLeft and page-sized steps use the row's local pixels. */
function toLocal(delta: number, mode: number, page: number, zoom: number): number {
  return mode === 2 ? delta * page : delta * (mode === 1 ? WHEEL_LINE : 1) / zoom;
}

/** A vertical-dominant gesture redirected into sideways travel. */
export function wheelPush(event: WheelInput, page: number, zoom: number): WheelPush | null {
  if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return null;
  const by = toLocal(event.deltaY, event.deltaMode, page, zoom);
  return by === 0 ? null : { by };
}

/** A sideways-dominant gesture's own travel, for rows that must apply it themselves. */
function wheelSideways(event: WheelInput, page: number, zoom: number): WheelPush | null {
  if (event.ctrlKey || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return null;
  const by = toLocal(event.deltaX, event.deltaMode, page, zoom);
  return by === 0 ? null : { by };
}

/** A wheel's sideways travel for a row that only scrolls sideways, in the row's local px, or null to
 *  leave the wheel alone. A sideways-dominant gesture always travels; a vertical-dominant one is
 *  redirected only when `verticalTaken()` says no vertical scroller (the row, one inside it under the
 *  pointer, or one around it) would take it; pinch (ctrl+wheel) never travels. */
export function rowWheel(event: WheelInput, page: number, zoom: number, verticalTaken: () => boolean): (WheelPush & { redirected: boolean }) | null {
  const sideways = wheelSideways(event, page, zoom);
  if (sideways) return { ...sideways, redirected: false };
  const push = wheelPush(event, page, zoom);
  return push && !verticalTaken() ? { ...push, redirected: true } : null;
}

interface WheelGlider {
  wheel(row: HTMLElement, by: number, instant: boolean): void;
  stop(): void;
}

/** Successive notches accumulate against the target; native scrolling interrupts the glide. */
export function wheelGlider(): WheelGlider {
  let target: number | null = null;
  let written = 0;
  let raf = 0;
  let at = 0;
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    target = null;
  };
  const drive = (row: HTMLElement) => {
    raf = requestAnimationFrame((time) => {
      if (target == null || !row.isConnected || Math.abs(row.scrollLeft - written) > 2) { stop(); return; }
      const dt = frameDt(at, time);
      at = time;
      const left = target - row.scrollLeft;
      if (Math.abs(left) < 0.5) { row.scrollLeft = target; stop(); return; }
      const before = row.scrollLeft;
      const step = followToward(row.scrollLeft, target, dt, 'shelf.row.wheel-glide') - row.scrollLeft;
      row.scrollLeft += step;
      written = row.scrollLeft;
      // CSS zoom can make the browser's actual scroll limit smaller than scrollWidth - clientWidth.
      if (step !== 0 && written === before) { stop(); return; }
      drive(row);
    });
  };
  return {
    stop,
    wheel(row, by, instant) {
      const base = raf && target != null ? target : row.scrollLeft;
      target = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, base + by));
      if (instant) { row.scrollLeft = target; stop(); return; }
      if (!raf) { written = row.scrollLeft; at = performance.now(); drive(row); }
    },
  };
}
