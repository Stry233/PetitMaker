// @vitest-environment jsdom
/**
 * The keyboard board resolves its keycap weights for the size its own fitting zoom draws them at,
 * on top of the card's chrome zoom.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { KeyboardBoard } from '../../../../../ui/chrome/modals/keyboard/KeyboardBoard';
import { useChromeScale, useDevicePixelRatio, useDenseScript } from '../../../../../ui/design/scale';
import { weightVars } from '../../../../../ui/design/text-weight';
import { setStoreState } from '../../../../_support/store';

/** The custom property a role's resolved weight is published as. */
const weightVar = (role: string) => `--fw-${role}`;

afterEach(cleanup);

/** The board's root, the element carrying its `zoom`, and the chrome inputs it resolves against. */
function mountBoard(zoom: number) {
  const chrome: { scale: number; dpr: number; dense: boolean } = { scale: 0, dpr: 0, dense: false };
  function Probe() {
    chrome.scale = useChromeScale();
    chrome.dpr = useDevicePixelRatio();
    chrome.dense = useDenseScript();
    return null;
  }
  const { container } = render(
    <>
      <Probe />
      <KeyboardBoard
        layer={{ ctrl: false, alt: false, shift: false }} index={new Map()} aliases={new Map()}
        selectedId={null} label={(id) => id} zoom={zoom} onPick={() => {}} onToggleMod={() => {}}
      />
    </>,
  );
  return { root: container.lastElementChild as HTMLElement, chrome };
}

describe('KeyboardBoard weights', () => {
  it('publishes the role weights for the chrome zoom times the board zoom', () => {
    setStoreState({ locale: 'en' });
    for (const zoom of [1, 0.6]) {
      const { root, chrome } = mountBoard(zoom);
      const expected = weightVars(chrome.scale * zoom, chrome.dpr, chrome.dense) as Record<string, string>;
      for (const role of ['small', 'caption'] as const) {
        expect(root.style.getPropertyValue(weightVar(role)), `${role} at ${zoom}`).toBe(expected[weightVar(role)]);
      }
      cleanup();
    }
  });
});
