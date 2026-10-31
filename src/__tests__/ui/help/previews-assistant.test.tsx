// @vitest-environment jsdom
/**
 * The Help Center's assistant figures mount the real `PanelShell` with fixture projections; a figure
 * must never reach outside its frame. `PreviewFrame` marks its subtree `aria-hidden`, which only the
 * `*ByRole` queries filter on, so the test-id and text queries see it. Reduced motion lets the
 * character mount without jsdom's missing Web Animations API.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act, render, renderHook, screen, cleanup, fireEvent } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { en } from '../../../i18n/locales/en';
import { HELP_TABLES, installHelpTables } from '../../_support/locale-tables';
import { setStoreState } from '../../_support/store';
import { onCharacterCue, useCharacterChannel, useCharacterIntent, type CharacterCue } from '../../../ui/agent/character/intent';
import { spec } from '../../_support/spec';
import {
  AgentDreamPreview, AgentOversightPreview, AgentPlanPreview, AgentRegionPreview, AgentSetupDetectPreview, AgentSetupPreview, AgentSteerPreview,
  AgentUndoPreview,
} from '../../../ui/help/figures/previews/assistant';
import { TourPreview } from '../../../ui/help/figures/previews/tour';

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

/** `FloatMenu`'s dismissal layer, a full-viewport fixed div that answers the pointer; one at the body
 *  would absorb every click over the live app. */
function bodyClickCatchers(): HTMLElement[] {
  return [...document.body.querySelectorAll('div')].filter((el) => (
    el.style.position === 'fixed' && el.style.inset === '0px' && el.style.pointerEvents === 'auto'
  ));
}

// The Help Center's tables are a lazy overlay registered when the help chunk loads.
beforeAll(() => {
  installHelpTables();
});

afterEach(() => {
  cleanup();
});

describe('assistant previews', () => {
  spec('UI-38', 'a pictured panel leaves the live character\'s pose and dream alone, mounted and closed', () => {
    setStoreState({ locale: 'en' });
    const live = renderHook(useCharacterChannel).result.current;
    const intent = renderHook(useCharacterIntent);
    const cues: CharacterCue[] = [];
    const off = onCharacterCue((cue) => cues.push(cue));
    act(() => live.setPose('trouble'));
    try {
      const figure = mount(<AgentDreamPreview />);
      expect(figure.getByTestId('dream-office')).toBeTruthy();
      expect(intent.result.current).toEqual({ pose: 'trouble', dream: 'off' });
      figure.unmount();
      expect(intent.result.current).toEqual({ pose: 'trouble', dream: 'off' });
      expect(cues).toEqual([]);
    } finally {
      off();
      act(() => live.setPose(null));
    }
  });

  it('mounts AgentSetupPreview as the whole connect screen, with no network asked', () => {
    setStoreState({ locale: 'en' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mount(<AgentSetupPreview />);
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
    expect(screen.getByTestId('setup-prov-sub').textContent).toBe(label('agent.setup_row_sofar'));
  });

  it('mounts AgentOversightPreview as the manage card\'s own three-level control with its caption', () => {
    setStoreState({ locale: 'en' });
    mount(<AgentOversightPreview />);
    for (const key of ['agent.oversight_strict', 'agent.oversight_checkpoint', 'agent.oversight_yolo']) {
      expect(screen.getByText(label(key))).toBeTruthy();
    }
    expect(screen.getByText(label('agent.oversight_checkpoint_caption'))).toBeTruthy();
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
    // Never portalled past the frame.
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

  it('mounts TourPreview as the pictured shell under the tips\' window, its reel resting on its poster', () => {
    setStoreState({ locale: 'en' });
    const { container } = mount(<TourPreview />);
    expect(container.querySelector('[data-testid="tour-deck"]')).toBeTruthy();
    expect(container.querySelector('[data-tour-target="modes"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="tour-reel-clip-poster"]')).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
  });
});
