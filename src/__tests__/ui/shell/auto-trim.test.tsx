import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider, translateFor } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { useEditorStore } from '../../../state/store';
import { TerrainBar } from '../../../ui/shell/bars/TerrainBar';
import { EC_STATE_KEY } from '../../../ui/shell/bars/edge-cut-glyph';

beforeEach(() => {
  useEditorStore.setState({ locale: 'en', autoEdgeCut: 'off' });
  useEditorStore.getState().setEditMode({ mode: 'mountain', tool: 'brush' });
  render(<MotionConfig reducedMotion="always"><I18nProvider><TerrainBar surface="mountain"/></I18nProvider></MotionConfig>);
});
afterEach(cleanup);
const group = () => screen.getByRole('group', { name: 'Auto Trim' });
const selected = () => within(group()).getByRole('button', { pressed: true });

describe('automatic corner settings', () => {
  it('selects each corner treatment directly inside one pill', () => {
    for (const [mode, name] of [['rect', 'Bevel'], ['round', 'Round'], ['off', 'No Trim']]) {
      fireEvent.click(within(group()).getByRole('button', { name }));
      expect(useEditorStore.getState().autoEdgeCut).toBe(mode);
      expect(selected().getAttribute('aria-label')).toBe(name);
      expect(within(group()).getAllByRole('button')).toHaveLength(3);
      expect(screen.queryByRole('menu')).toBeNull();
    }
  });
  it.each(['Edge Cut', 'Smart build'])('hides when unavailable for %s', label => {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.queryByRole('group', { name: 'Auto Trim' })).toBeNull();
    expect(useEditorStore.getState().autoEdgeCut).toBe('off');
  });
  it('offers corner treatments for the eraser', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    fireEvent.click(within(group()).getByRole('button', { name: 'Round' }));
    expect(useEditorStore.getState().autoEdgeCut).toBe('round');
    expect(selected().getAttribute('aria-label')).toBe('Round');
  });
  it('gives No Trim the same pill treatment as the cutting modes', () => {
    const plate = group().querySelector('[data-option-plate]');
    expect(selected().getAttribute('aria-label')).toBe('No Trim');
    fireEvent.click(within(group()).getByRole('button', { name: 'Bevel' }));
    expect(group().querySelector('[data-option-plate]')).toBe(plate);
    expect(selected().style.opacity).toBe(within(group()).getByRole('button', { name: 'No Trim' }).style.opacity);
  });
  it('retains the treatment across tool switches', () => {
    act(() => useEditorStore.getState().setAutoEdgeCut('rect'));
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Brush' }));
    expect(selected().getAttribute('aria-label')).toBe('Bevel');
  });
  it('names every treatment in all locales', () => {
    for (const locale of Object.keys(translations) as (keyof typeof translations)[]) {
      for (const key of ['edgecut.auto', ...Object.values(EC_STATE_KEY)]) {
        expect(translateFor(locale, key).trim()).not.toBe(key);
      }
    }
  });
});
