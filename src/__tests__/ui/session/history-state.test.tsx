// @vitest-environment jsdom
/**
 * Undo and Redo show what the map's history holds when they appear, not only after the next history
 * change: a history pair mounted over an edited map offers Undo, and a map swapped in offers what
 * its own history holds.
 */
import { describe, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { CommandType, TerrainType } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules/index';
import { makeTemplate } from '../../_support/map-state';
import { resetStore } from '../../_support/store';
import { Rail } from '../../../ui/shell/Rail';

const undo = () => screen.getByLabelText('Undo');
const redo = () => screen.getByLabelText('Redo');

function paintOneCell(): void {
  const result = useEditorStore.getState().commandExecutor!.execute({
    type: CommandType.PaintTerrain, cells: [{ x: 3, y: 3 }], terrainType: TerrainType.Mountain, elevation: 0,
  });
  expect(result.success).toBe(true);
}

beforeEach(() => {
  window.innerHeight = 900;
  resetStore();
  useEditorStore.setState({ locale: 'en' });
  useEditorStore.getState().initMap(makeTemplate(8, 8), createDefaultRegistry());
});
afterEach(() => { cleanup(); resetStore(); });

describe('the history pair', () => {
  spec('UI-10', 'offers Undo for an edit made before it appeared, and follows a map swapped in', () => {
    paintOneCell();
    render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);
    expect(undo()).toHaveProperty('disabled', false);
    expect(redo()).toHaveProperty('disabled', true);

    act(() => { useEditorStore.getState().initMap(makeTemplate(8, 8), createDefaultRegistry()); });
    expect(undo()).toHaveProperty('disabled', true);
  });
});
