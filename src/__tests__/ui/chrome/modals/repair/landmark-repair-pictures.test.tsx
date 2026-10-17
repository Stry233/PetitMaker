// @vitest-environment jsdom
/**
 * The landmark repair's two pictures show the loaded map as either choice opens it, plan notes
 * included, and they are taken by the same renderer and preview as Change Planet's carry pictures.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { inspectImportFile } from '../../../../../io/import/file';
import { commitImport } from '../../../../../editor/session/import-flow';
import { cancelRepair, installRepairWatch } from '../../../../../editor/session/landmark-repair';
import { newMap } from '../../../../../editor/operations';
import { editorPort } from '../../../../../editor/session/context';
import { getMapTemplate } from '../../../../../config/maps';
import { createGridState } from '../../../../../core/model/template';
import { LandmarkRepairWindow } from '../../../../../ui/chrome/modals/repair/LandmarkRepairWindow';
import { PlanetCarryStep } from '../../../../../ui/chrome/modals/planet/PlanetCarryStep';
import { drawnNotes, installPictureRenderer, sampleNotes } from '../../../../_support/picture-renderer';

// Reading and planning a whole visitor's map outlasts the default timeout on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const FILE = join(__dirname, '..', '..', '..', '..', 'fixtures', 'saves', 'hexia-plaza-frame-1.5.557.json.gz');

let pictures: ReturnType<typeof installPictureRenderer>;
let stopWatch: () => void = () => {};
beforeEach(() => {
  newMap(editorPort, 'hexia');
  stopWatch = installRepairWatch();
  pictures = installPictureRenderer();
});
afterEach(() => {
  cleanup();
  if (useEditorStore.getState().repairSession) cancelRepair();
  stopWatch();
  pictures.uninstall();
});

/** Opens the fixture save, which asks the repair, with `notes` on the map it would open. */
async function askRepair(notes = sampleNotes()) {
  const text = gunzipSync(readFileSync(FILE)).toString('utf8');
  const blob = new Blob([text], { type: 'application/json' });
  const inspection = await inspectImportFile(blob, 'hexia.json');
  if (inspection.status !== 'ready') throw new Error(`inspection ${inspection.status}`);
  commitImport({ inspection, name: 'hexia.json', file: blob });
  const session = useEditorStore.getState().repairSession;
  if (session?.phase !== 'choose') throw new Error('no repair asked');
  session.pending.annotations = notes;
  return session.pending;
}

describe('the landmark repair pictures', () => {
  it('draw the loaded map\'s notes on both choices', async () => {
    const pending = await askRepair();
    const { baseElement } = render(<I18nProvider><LandmarkRepairWindow /></I18nProvider>);
    for (const id of ['repair-auto-option', 'repair-hand-option']) {
      const preview = within(within(baseElement).getByTestId(id)).getByTestId('planet-preview');
      await waitFor(() => expect(preview.getAttribute('aria-busy')).toBeNull());
    }
    const states = new Set(pictures.calls.map((c) => c.state));
    expect(states.size, 'one picture per choice').toBe(2);
    expect(pictures.calls.every((c) => drawnNotes(c) === pending.annotations)).toBe(true);
  });

  it('leave the notes out where the loaded map hides them', async () => {
    await askRepair(sampleNotes(false));
    const { baseElement } = render(<I18nProvider><LandmarkRepairWindow /></I18nProvider>);
    const preview = within(within(baseElement).getByTestId('repair-auto-option')).getByTestId('planet-preview');
    await waitFor(() => expect(preview.getAttribute('aria-busy')).toBeNull());
    expect(pictures.calls.length).toBeGreaterThan(0);
    expect(pictures.calls.every((c) => drawnNotes(c) === null)).toBe(true);
  });

  it('are the same preview, taken by the same renderer, as the planet switch\'s', async () => {
    await askRepair();
    const repair = render(<I18nProvider><LandmarkRepairWindow /></I18nProvider>);
    const target = getMapTemplate('tafa');
    const carried = createGridState(target);
    carried.annotations = sampleNotes();
    const preview = { state: carried, dropped: [], moved: { cells: 0, objects: 0 }, droppedCounts: { cells: 0, objects: 0 } };
    const carry = render(<I18nProvider><PlanetCarryStep target={target} preview={preview} carry="carry" onCarry={() => {}} labelledBy="x" /></I18nProvider>);
    const stages = [
      ...within(repair.baseElement).getByTestId('landmark-repair').querySelectorAll('[data-testid="planet-preview"]'),
      ...carry.container.querySelectorAll('[data-testid="planet-preview"]'),
    ];
    expect(stages.length).toBeGreaterThanOrEqual(4);
    for (const stage of stages) await waitFor(() => expect(stage.getAttribute('aria-busy')).toBeNull());
    // Both windows' pictures arrive through the one capture: the repair's two maps, and the
    // transfer's own map with what it carries.
    const carriedCall = pictures.calls.find((c) => c.state === carried);
    expect(carriedCall && drawnNotes(carriedCall)).toBe(carried.annotations);
    const repaired = new Set(pictures.calls.filter((c) => c.state.template !== target).map((c) => c.state));
    expect(repaired.size).toBe(2);
  });
});
