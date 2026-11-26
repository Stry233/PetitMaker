// @vitest-environment jsdom
/** A rail cell that refolds during a UI-zoom glide rides the glide to its new place, never back. */
import { afterEach, beforeEach, expect } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MotionConfig, type MotionValue } from 'framer-motion';
import { spec } from '../../../_support/spec';
import { resetStore, setStoreState } from '../../../_support/store';
import { useEditorStore } from '../../../../state/store';
import { __resetUiZoomAnim } from '../../../../ui/design/ui-zoom-anim';
import { useLocalReflow } from '../../../../ui/shell/controls/use-local-reflow';

let offset: { x: MotionValue<number> } | null = null;
function Cell({ x, place }: { x: number; place: string }) {
  offset = useLocalReflow(x, 0, place, { motionId: 'rail.group.reflow' });
  return null;
}
const frames = (n: number) => act(() => new Promise<void>((done) => {
  let left = n;
  const tick = () => { if (--left <= 0) done(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}));

beforeEach(() => { resetStore(); setStoreState({ uiZoom: 1 }); __resetUiZoomAnim(); });
afterEach(() => { cleanup(); offset = null; __resetUiZoomAnim(); });

spec('UI-28', 'a cell refolded in a UI-zoom glide keeps closing on its place when the glide is re-aimed, as a held key re-aims it', async () => {
  const view = render(<MotionConfig reducedMotion="never"><Cell x={0} place="a" /></MotionConfig>);
  act(() => { useEditorStore.getState().setUiZoom(1.3); });
  await frames(2);
  view.rerender(<MotionConfig reducedMotion="never"><Cell x={-100} place="b" /></MotionConfig>);
  await frames(6);
  const before = offset!.x.get();
  expect(before, 'the cell is on its way').toBeGreaterThan(0);
  expect(before).toBeLessThan(100);
  act(() => { useEditorStore.getState().setUiZoom(1.6); });
  await frames(1);
  expect(offset!.x.get(), 'a re-aimed glide carries the cell on from where it stands').toBeLessThanOrEqual(before + 0.5);
});
