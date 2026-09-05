/**
 * The Help Center's assistant figures mount the REAL `PanelShell` with fixture projections, so this
 * pins the mounts themselves plus the one way a figure can break the app: reaching outside its
 * frame. `PreviewFrame` marks its whole subtree `aria-hidden`, which only the `*ByRole` queries
 * filter on by default; the test-id and text queries here see the subtree either way.
 *
 * Wrapper matches `panel-shell.test.tsx`: `MotionConfig reducedMotion="always"`, so the character
 * mounts without jsdom's missing Web Animations API.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { en } from '../../../i18n/locales/en';
import { ensureHelpStrings, HELP_TABLES } from '../../../i18n/locales/help';
import { setStoreState } from '../../_store';
import {
  AgentOversightPreview, AgentPlanPreview, AgentRegionPreview, AgentSetupDetectPreview, AgentSetupPreview, AgentSteerPreview,
  AgentUndoPreview,
} from '../../../ui/chrome/modals/help/figures/previews/assistant';
import { TourPreview } from '../../../ui/chrome/modals/help/figures/previews/tour';

const merged: Record<string, string | undefined> = { ...en, ...HELP_TABLES.en };

function label(key: string): string {
  const text = merged[key];
  if (!text) throw new Error(`no English string for ${key}`);
  return text;
}

function mount(node: React.ReactElement) {
  return render(
    <MotionConfig reducedMotion="always"><I18nProvider>{node}</I18nProvider></MotionConfig>,
  );
}

/** `FloatMenu`'s dismissal layer: a full-viewport fixed div that answers the pointer. A figure must
 *  never stand one at the body, where it would absorb every click over the live app. */
function bodyClickCatchers(): HTMLElement[] {
  return [...document.body.querySelectorAll('div')].filter((el) => (
    el.style.position === 'fixed' && el.style.inset === '0px' && el.style.pointerEvents === 'auto'
  ));
}

// The Help Center's own tables arrive as a lazy overlay (`i18n/locales/help`), registered only once
// the help chunk loads; a preview rendered outside that chunk needs the same registration a test
// gives it explicitly.
beforeAll(() => {
  ensureHelpStrings();
});

afterEach(() => {
  cleanup();
});

describe('assistant previews', () => {
  it('mounts AgentSetupPreview as the whole connect screen, with no network asked', () => {
    setStoreState({ locale: 'en' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mount(<AgentSetupPreview />);
    // The real screen's own key field stands, at the empty key step.
    expect(screen.getByTestId('setup-key-input')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('mounts AgentSetupDetectPreview with the real key field, masked, and the screen\'s own provider face', () => {
    setStoreState({ locale: 'en' });
    mount(<AgentSetupDetectPreview />);
    const input = screen.getByTestId('setup-key-input') as HTMLInputElement;
    expect(input.type).toBe('password');
    const face = screen.getByTestId('setup-prov-face');
    expect(face.getAttribute('data-provider')).toBe('claude');
    expect(screen.getByText('Anthropic')).toBeTruthy();
    expect(screen.getByTestId('setup-prov-sub').textContent).toBe(label('agent3.setup_row_sofar'));
  });

  it('mounts AgentOversightPreview as the manage card\'s own three-level control with its caption', () => {
    setStoreState({ locale: 'en' });
    mount(<AgentOversightPreview />);
    for (const key of ['agent3.oversight_strict', 'agent3.oversight_checkpoint', 'agent3.oversight_yolo']) {
      expect(screen.getByText(label(key))).toBeTruthy();
    }
    expect(screen.getByText(label('agent3.oversight_checkpoint_caption'))).toBeTruthy();
  });

  it('mounts AgentSteerPreview as the panel mid-run: two op rows and the queued note inside it', () => {
    setStoreState({ locale: 'en' });
    mount(<AgentSteerPreview />);
    const panel = screen.getByTestId('panel-shell');
    expect(screen.getByTestId('ticket-order').textContent).toBe(label('help.fig.steer_job'));
    expect(screen.getAllByTestId('op-row')).toHaveLength(2);
    const chip = screen.getByTestId('panel-steer-chip');
    expect(panel.contains(chip)).toBe(true);
    expect(chip.textContent).toContain(label('help.fig.steer_note'));
  });

  it('mounts AgentPlanPreview as the real panel gated on its plan, three stages and one flag', () => {
    setStoreState({ locale: 'en' });
    mount(<AgentPlanPreview />);
    const panel = screen.getByTestId('panel-shell');
    const gate = screen.getByTestId('plan-gate');
    expect(panel.contains(gate)).toBe(true);
    expect(screen.getAllByTestId('plan-stage')).toHaveLength(3);
    expect(screen.getAllByTestId('plan-flag')).toHaveLength(1);
  });

  it('mounts AgentRegionPreview with the region chip docked in the real composer', () => {
    setStoreState({ locale: 'en' });
    mount(<AgentRegionPreview />);
    const panel = screen.getByTestId('panel-shell');
    const chip = screen.getByTestId('composer-region-chip');
    expect(panel.contains(chip)).toBe(true);
  });

  it('mounts AgentUndoPreview with the past-jobs list open inside the panel, one row rolled back', () => {
    setStoreState({ locale: 'en' });
    mount(<AgentUndoPreview />);
    const panel = screen.getByTestId('panel-shell');
    const rows = screen.getAllByTestId('history-item');
    expect(rows).toHaveLength(2);
    // The open list stands INSIDE the pictured panel, never portalled past its frame.
    for (const row of rows) expect(panel.contains(row)).toBe(true);
    expect(rows.some((row) => row.getAttribute('data-rolled-back') === 'true')).toBe(true);
  });

  /** A posed open list must not install page-level pointer or Escape handlers. */
  it('leaves no click catcher at the body and lets Escape travel, with the undo figure standing', () => {
    setStoreState({ locale: 'en' });
    mount(<AgentUndoPreview />);
    expect(bodyClickCatchers()).toHaveLength(0);
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    window.removeEventListener('keydown', outer);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('mounts TourPreview as the pictured shell under the tour dim', () => {
    setStoreState({ locale: 'en' });
    const { container } = mount(<TourPreview />);
    // The dim is up from the first frame; the bubble waits on a measured target box, which a DOM
    // environment (zero-size rects) never delivers — the pictured shell and its target are the
    // mount this test can pin.
    expect(container.querySelector('[data-testid="help-tour-dim"]')).toBeTruthy();
    expect(container.querySelector('[data-tour-target="modes"]')).toBeTruthy();
  });
});
