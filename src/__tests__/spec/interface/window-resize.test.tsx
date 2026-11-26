// @vitest-environment jsdom
/**
 * A window resized without changing the arrangement: the corner actions and the right-hand column stay
 * pinned to the window's edge, taking each new place at once, while a change of the plan the window did
 * not make still glides, and a button the column refolds travels to its new cell.
 */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { resetStore, setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { FrameLayoutProvider, useFrameLayout, type LayoutState } from '../../../ui/shell/frame-layout';
import { CornerActions } from '../../../ui/shell/controls/CornerActions';
import { RailButton } from '../../../ui/shell/controls/RailButton';
import { viewKitCell } from '../../../ui/shell/frame';
import type { ChromeSwap } from '../../../ui/shell/controls/ModeRow';

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

const wide = ({ children }: { children: ReactNode }) => (
  <InputModeProvider inputMode="pc" shape="landscape"><I18nProvider><FrameLayoutProvider><PlanProbe />{children}</FrameLayoutProvider></I18nProvider></InputModeProvider>
);

beforeEach(() => { resetStore(); setStoreState({ locale: 'en', inputMode: 'pc', layoutShape: 'landscape', uiZoom: 1 }); resizeTo(1280, 800); });
afterEach(() => { cleanup(); plan = null; resizeTo(1024, 768); });

describe('a resize that keeps the arrangement', () => {
  spec('UI-28', 'moves the corner actions with the window at once, and glides them only for a change the window did not make', () => {
    const corner = <CornerActions pose="map" swap={{} as ChromeSwap} menuOpen={false} toggleMenu={() => {}} menuButton={{ current: null }} />;
    render(corner, { wrapper: wide });
    const glides = () => screen.getByTestId('shell-corner-actions').style.transition.includes('top');
    expect(glides(), 'at rest the plan glides what it moves').toBe(true);
    for (const [w, h] of [[1200, 780], [1120, 760], [1260, 790]] as const) {
      act(() => { resizeTo(w, h); });
      expect(glides(), `resized to ${w}x${h}, it takes its new place at once`).toBe(false);
    }
    act(() => { plan!.setLayerMode('column'); });
    expect(glides(), 'a change of the plan the window did not make glides again').toBe(true);
  });

  spec('UI-28', 'carries a right-hand column button to the cell a resize refolds the column into', async () => {
    /** The view kit's last button, in the cell the live plan gives it. */
    function LastKitButton() {
      const rail = useFrameLayout()!.rail;
      return (
        <RailButton morph="probe" label="Probe" grow="left" files={rail.kitFiles}
          cell={viewKitCell(rail.kitButtons - 1, rail.kitButtons, rail.kitFiles)} onPress={() => {}}><span /></RailButton>
      );
    }
    render(<MotionConfig reducedMotion="never"><LastKitButton /></MotionConfig>, { wrapper: wide });
    const button = screen.getByRole('button', { name: 'Probe' });
    const files = plan!.rail.kitFiles;
    const refold = [[1280, 600], [1280, 1000], [1280, 480]].find(([w, h]) => {
      act(() => { resizeTo(w!, h!); });
      return plan!.rail.kitFiles !== files;
    });
    expect(refold, 'some window height refolds the view kit').toBeDefined();
    // Motion values reach the style on an animation frame: the travel shows within its first few.
    for (let i = 0; i < 30 && !/translate/.test(button.style.transform); i++) {
      await act(() => new Promise((done) => { requestAnimationFrame(done); }));
    }
    expect(button.style.transform, 'the refolded button travels from the cell it stood in').toMatch(/translate/);
  });
});

