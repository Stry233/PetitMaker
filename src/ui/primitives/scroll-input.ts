import { MOTIONS } from '../shell/motion/registry';

interface WheelInput { deltaX: number; deltaY: number; deltaMode: number; ctrlKey?: boolean }
interface WheelPush { by: number }
const WHEEL_LINE = 40;
const GLIDE_TAU_MS = MOTIONS['shelf.row.wheel-glide'].duration * 1000;
const GLIDE_DT_CAP_MS = 64;

/** Wheel deltas are visual pixels; scrollLeft and page-sized steps use the row's local pixels. */
export function wheelPush(event: WheelInput, page: number, zoom: number): WheelPush | null {
  if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return null;
  const by = event.deltaMode === 2 ? event.deltaY * page
    : event.deltaY * (event.deltaMode === 1 ? WHEEL_LINE : 1) / zoom;
  return by === 0 ? null : { by };
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
      // A frame timestamp can precede the event's performance.now(), and background gaps are unbounded.
      const dt = Math.max(0, Math.min(GLIDE_DT_CAP_MS, time - at));
      at = time;
      const left = target - row.scrollLeft;
      if (Math.abs(left) < 0.5) { row.scrollLeft = target; stop(); return; }
      const before = row.scrollLeft;
      const step = left * (1 - Math.exp(-dt / GLIDE_TAU_MS));
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
