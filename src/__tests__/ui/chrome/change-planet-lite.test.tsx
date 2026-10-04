/** An edition that reads no planet files and no videos offers neither Import planet nor Export. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, within } from '@testing-library/react';

vi.mock('../../../core/runtime/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../core/runtime/edition')>()),
  SUPPORTS_JSON_FILES: false,
  SUPPORTS_VIDEO_IMPORT: false,
}));

import { ChangePlanetModal } from '../../../ui/chrome/modals/ChangePlanetModal';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { createGrid } from '../../../core/model/grid-model';
import { MAP_TEMPLATES } from '../../../config/maps';
import type { GridState } from '../../../core/model/types';
import { savePlanet } from '../../../io/planet-library';
import { planetFixture } from '../../fixtures/planet';

const HEXIA = MAP_TEMPLATES['hexia']!;

beforeEach(() => {
  localStorage.clear();
  const state: GridState = { template: HEXIA, cells: createGrid(HEXIA), objects: new Map(), lockedLayers: new Set() };
  act(() => { useEditorStore.setState({ gridState: state, commandExecutor: null, exportedAt: null, locale: 'en' }); });
});
afterEach(() => { cleanup(); });

describe('Change Planet without planet files', () => {
  it('has no import row and no export tool', () => {
    const saved = savePlanet('Bay', planetFixture());
    if (!saved.ok) throw new Error('save failed');
    render(<I18nProvider><ChangePlanetModal onSwitch={() => {}} onClose={() => {}} initialChosen={saved.entry.entryId} /></I18nProvider>);
    expect(screen.getByTestId('planet-new')).toBeTruthy();
    expect(screen.queryByTestId('planet-import')).toBeNull();
    expect(screen.queryByTestId('planet-file')).toBeNull();
    const tools = within(screen.getByTestId('planet-tools'));
    expect(tools.getByRole('button', { name: 'Rename' })).toBeTruthy();
    expect(tools.queryByRole('button', { name: 'Export' })).toBeNull();
  });
});
