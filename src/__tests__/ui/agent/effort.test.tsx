import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { EffortControl } from '../../../ui/agent/EffortControl';
import { effortKey, runnerSettings, useAgentPanelSettings } from '../../../ui/agent/settings';
import { ensureModelCatalog, resetModelCatalog } from '../../../agent/providers/model-catalog';
import { saveAgentSettings, loadAgentSettings } from '../../../agent/security/key-storage';

beforeEach(() => {
  useEditorStore.setState({ locale: 'en' });
  useAgentPanelSettings.setState({ provider: 'openai', effort: {}, hydrated: false });
  useAgentPanelSettings.getState().setModel('current-model');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetModelCatalog(); });

it('shows the exact supported levels, updates the request setting and keeps another model independent', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ openai: { models: { 'current-model': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] } } } }) }));
  const changed = vi.fn();
  render(<I18nProvider><EffortControl onChange={changed} /></I18nProvider>);
  expect(screen.queryByRole('slider')).toBeNull();
  await act(async () => { await ensureModelCatalog(true); });
  const slider = screen.getByRole('slider');
  expect(slider.getAttribute('max')).toBe('3');
  expect(slider.getAttribute('aria-valuetext')).toBe('Default');
  fireEvent.change(slider, { target: { value: '2' } });
  expect(slider.getAttribute('aria-valuetext')).toBe('High');
  expect(runnerSettings(useAgentPanelSettings.getState()).effort).toBe('high');
  expect(changed).toHaveBeenCalledTimes(1);
  act(() => { useAgentPanelSettings.getState().setModel('another-model'); });
  expect(screen.queryByRole('slider')).toBeNull();
  expect(runnerSettings(useAgentPanelSettings.getState()).effort).toBeUndefined();
  act(() => { useAgentPanelSettings.getState().setModel('current-model'); });
  expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('High');
  fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } });
  expect(runnerSettings(useAgentPanelSettings.getState()).effort).toBe('auto');
});

it('persists effort in the existing settings record', () => {
  const state = useAgentPanelSettings.getState();
  const key = effortKey(state);
  saveAgentSettings({ ...loadAgentSettings(), effort: { [key]: 'high' } });
  expect(loadAgentSettings().effort).toEqual({ [key]: 'high' });
});
