/*
 * The registry as CSS custom properties on the document element, so a stylesheet animation names a
 * motion the way a component does: `--motion-<id>` is a timed motion's length and curve, ready for an
 * `animation` or `transition` shorthand, and `--motion-<id>-stagger` its stagger. Written once at boot;
 * the registry does not change while the page runs.
 */
import { easingCss, seconds } from '.';
import { MOTIONS, type Motion, type MotionId } from './registry';

/** The custom property a motion's timing is published under. */
export function motionVar(id: MotionId): string {
  return `--motion-${id.replace(/\./g, '-')}`;
}

/** Every timed motion's properties, by name. */
function motionVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const id of Object.keys(MOTIONS) as MotionId[]) {
    const m: Motion = MOTIONS[id];
    if (typeof m.duration !== 'number') continue;
    vars[motionVar(id)] = `${seconds(id)}s ${easingCss(id)}`;
    if (m.stagger !== undefined) vars[`${motionVar(id)}-stagger`] = `${m.stagger}s`;
  }
  return vars;
}

/** Writes the properties onto `root`. */
export function publishMotionVars(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(motionVars())) root.style.setProperty(name, value);
}
