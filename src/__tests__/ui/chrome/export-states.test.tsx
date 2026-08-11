import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExportModal } from '../../../ui/chrome/modals/export/ExportModal';
import { makeState } from '../../rules/_helpers';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { CommandType, TerrainType, type Command } from '../../../core/model/types';
import { ProvSource } from '../../../core/provenance/types';
import { I18nProvider } from '../../../i18n/context';
import { setStoreState, setStoreModal } from '../../_store';
import { roadLookup } from '../../../state/object-index';


function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function openWith(setup: (e: CommandExecutor) => void) {
  const s = makeState(8, 8); const e = new CommandExecutor(s, new EventBus(), createDefaultRegistry(), roadLookup(s));
  setup(e); setStoreState({ gridState: s, commandExecutor: e, locale: 'en' });
  setStoreModal('export');
}
const paint = (x: number, y: number): Command => ({ type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1 } as Command);

describe('export modal — provenance states', () => {
  beforeEach(() => setStoreState({ locale: 'en' }));

  it('AI map shows the badge toggle ENABLED', () => {
    openWith((e) => { const s = e.getUndoStackSize(); e.withSource({ source: ProvSource.AiWrite }, () => e.execute(paint(1, 1))); e.commitStroke(s); });
    render(<ExportModal />, { wrapper: Wrapper });
    expect(screen.getByRole('switch', { name: 'Show provenance badge' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('procedural map shows the badge toggle ENABLED', () => {
    openWith((e) => { const s = e.getUndoStackSize(); e.withSource({ source: ProvSource.Procedural, procedural: { seed: 1, algorithm: 'random', configHash: 'h' } }, () => e.execute(paint(1, 1))); e.commitStrokeGroup(s); });
    render(<ExportModal />, { wrapper: Wrapper });
    expect(screen.getByRole('switch', { name: 'Show provenance badge' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('AI-used-then-removed shows the badge control DISABLED (visible, not hidden)', () => {
    openWith((e) => {
      const s = e.getUndoStackSize(); e.withSource({ source: ProvSource.AiWrite }, () => e.execute(paint(1, 1))); e.commitStroke(s);
      const s2 = e.getUndoStackSize(); e.execute({ type: CommandType.EraseTerrain, timestamp: 0, cells: [{ x: 1, y: 1 }] } as Command); e.commitStroke(s2);
    });
    render(<ExportModal />, { wrapper: Wrapper });
    expect(screen.getByRole('switch', { name: 'Show provenance badge' }).getAttribute('aria-disabled')).toBe('true');
  });
});
