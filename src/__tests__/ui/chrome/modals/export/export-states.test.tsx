// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShareWindow } from '../../../../../ui/chrome/modals/export/ShareWindow';
import { makeState } from '../../../../_support/map-state';
import { CommandExecutor } from '../../../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../../../rules';
import { CommandType, TerrainType, type Command } from '../../../../../core/model/types';
import { ProvSource } from '../../../../../core/provenance/types';
import { I18nProvider } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { setStoreState } from '../../../../_support/store';
import { createExecutor } from '../../../../../state/executor';


function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function openWith(setup: (e: CommandExecutor) => void) {
  const s = makeState(8, 8); const e = createExecutor(s, createDefaultRegistry());
  setup(e); setStoreState({ gridState: s, commandExecutor: e, locale: 'en' });
  useEditorStore.getState().openShare('friend');
}
const paint = (x: number, y: number): Command => ({
  type: CommandType.PaintTerrain, cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1,
} as Command);

describe('export modal — provenance states', () => {
  beforeEach(() => setStoreState({ locale: 'en' }));

  it('AI map shows the badge toggle ENABLED', () => {
    openWith((e) => { const s = e.beginStroke(); e.transaction({ source: { source: ProvSource.AiWrite } }, () => e.execute(paint(1, 1))); s.commit(); });
    render(<ShareWindow />, { wrapper: Wrapper });
    expect(screen.getByRole('switch', { name: 'Show provenance badge' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('procedural map shows the badge toggle ENABLED', () => {
    openWith((e) => { const s = e.beginStroke(); e.transaction({ source: { source: ProvSource.Procedural, procedural: { seed: 1, algorithm: 'designed', configHash: 'h' } } }, () => e.execute(paint(1, 1))); s.commit(); });
    render(<ShareWindow />, { wrapper: Wrapper });
    expect(screen.getByRole('switch', { name: 'Show provenance badge' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('AI-used-then-removed shows the badge control DISABLED (visible, not hidden)', () => {
    openWith((e) => {
      const s = e.beginStroke(); e.transaction({ source: { source: ProvSource.AiWrite } }, () => e.execute(paint(1, 1))); s.commit();
      const s2 = e.beginStroke(); e.execute({ type: CommandType.EraseTerrain, cells: [{ x: 1, y: 1 }] } as Command); s2.commit();
    });
    render(<ShareWindow />, { wrapper: Wrapper });
    expect(screen.getByRole('switch', { name: 'Show provenance badge' }).getAttribute('aria-disabled')).toBe('true');
  });
});
