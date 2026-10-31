// @vitest-environment jsdom
/**
 * The layer control's name of the layer being built on, standing left of its plate: drawn whole in
 * every language and at the top layer, on a window short enough to fold the rail, where the plan's
 * compact column once capped and clipped it.
 */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { resetStore, setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { FrameLayoutProvider, useFrameLayout, type LayoutState } from '../../../ui/shell/frame-layout';
import { Rail } from '../../../ui/shell/Rail';
import { useEditorStore } from '../../../state/store';
import { ELEVATION_MAX, layerNumber } from '../../../core/game/profile';
import { LOCALES } from '../../../core/model/locale';

function resizeTo(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

let plan: LayoutState | null = null;
function PlanProbe() {
  plan = useFrameLayout();
  return null;
}

beforeEach(() => { resetStore(); setStoreState({ locale: 'en', inputMode: 'pc', layoutShape: 'landscape', uiZoom: 1.8 }); });
afterEach(() => { cleanup(); plan = null; resizeTo(1024, 768); });

/** Whether the readout or anything around it cuts what it draws. */
function clipped(el: HTMLElement): string | null {
  for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
    const { overflow, overflowX, overflowY, maxWidth, textOverflow } = a.style;
    if ([overflow, overflowX, overflowY].some((v) => v && v !== 'visible')) return `${a.dataset.testid ?? a.tagName} clips (${overflow || overflowX || overflowY})`;
    if (a === el && (maxWidth || textOverflow)) return `capped at ${maxWidth || textOverflow}`;
  }
  return null;
}

describe('the layer control names its layer whole', () => {
  spec('UI-11', 'on a window whose rail folds, every language at the top layer shows its whole name, nothing clipping it', () => {
    resizeTo(1280, 520);
    render(
      <InputModeProvider inputMode="pc" shape="landscape">
        <I18nProvider><FrameLayoutProvider><PlanProbe /><Rail hidden={false} onHide={() => {}} /></FrameLayoutProvider></I18nProvider>
      </InputModeProvider>,
    );
    expect(plan?.compact, 'the window is short enough to fold the rail').toBe(true);
    for (const locale of LOCALES) {
      act(() => { useEditorStore.setState({ locale, activeLayer: ELEVATION_MAX, displayLayer: null }); });
      const readout = screen.getByTestId('shell-layer-readout');
      expect(readout.textContent, locale).toContain(String(layerNumber(ELEVATION_MAX)));
      expect(clipped(readout), locale).toBeNull();
    }
  });
});
