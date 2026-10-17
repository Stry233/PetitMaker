// @vitest-environment jsdom
/**
 * The repair choice's pictures flag what the map would flag: the hand picture exactly the objects,
 * at exactly the footprints, the live map flags once a hand repair opens, and the automatic picture
 * the objects the plan removes and whatever it lands that would still stand against the rules. Read
 * from three visitor saves written by old releases.
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
import { cancelRepair, installRepairWatch, repairAutomatically, repairByHand } from '../../../../../editor/session/landmark-repair';
import { unresolved } from '../../../../../state/relocation-plan';
import { createDefaultRegistry } from '../../../../../rules';
import { newMap } from '../../../../../editor/operations';
import { editorPort } from '../../../../../editor/session/context';
import { host } from '../../../../../editor/host/host';
import { objectRect } from '../../../../../state/object-geometry';
import type { CompatibilityReport } from '../../../../../state/landmark-clearance';
import type { GridState, PlacedObject } from '../../../../../core/model/types';
import { LandmarkRepairWindow } from '../../../../../ui/chrome/modals/repair/LandmarkRepairWindow';
import { installPictureRenderer, type PictureCall } from '../../../../_support/picture-renderer';

vi.setConfig({ testTimeout: 120_000 });

const SAVES = join(__dirname, '..', '..', '..', '..', 'fixtures', 'saves');
const FIXTURES = ['hexia-plaza-frame-1.5.557.json.gz', 'hexia-complex-1.0.51.json.gz', 'custom-complex-1.6.1797.json.gz'];

let pictures: ReturnType<typeof installPictureRenderer>;
let stopWatch: () => void = () => {};
let shown: (readonly PlacedObject[] | null)[] = [];
beforeEach(() => {
  newMap(editorPort, 'hexia');
  stopWatch = installRepairWatch();
  pictures = installPictureRenderer();
  shown = [];
  vi.spyOn(host.flagged, 'show').mockImplementation((objects) => { shown.push(objects); });
});
afterEach(() => {
  cleanup();
  if (useEditorStore.getState().repairSession) cancelRepair();
  stopWatch();
  pictures.uninstall();
  vi.restoreAllMocks();
});

async function askRepair(file: string): Promise<CompatibilityReport> {
  const text = gunzipSync(readFileSync(join(SAVES, file))).toString('utf8');
  const blob = new Blob([text], { type: 'application/json' });
  const inspection = await inspectImportFile(blob, file);
  if (inspection.status !== 'ready') throw new Error(`inspection ${inspection.status}`);
  commitImport({ inspection, name: file, file: blob });
  const session = useEditorStore.getState().repairSession;
  if (session?.phase !== 'choose') throw new Error('no repair asked');
  return session.report;
}

/** Each flag as its id and the footprint it is drawn over, in a stable order. */
const marks = (objects: readonly PlacedObject[]) => objects.map((o) => ({ id: o.id, rect: objectRect(o) }))
  .sort((a, b) => (a.id < b.id ? -1 : 1));

/** Whether `state` holds every reported object where the save had it: the hand picture's map. */
const holdsSaved = (state: GridState, report: CompatibilityReport) => report.objects.every((o) => {
  const at = state.objects.get(o.object.id);
  return !!at && at.position.x === o.object.position.x && at.position.y === o.object.position.y;
});

/** The two pictures the window asked for, once both stages have theirs. */
async function choicePictures(report: CompatibilityReport): Promise<{ hand: PictureCall; auto: PictureCall }> {
  const { baseElement } = render(<I18nProvider><LandmarkRepairWindow /></I18nProvider>);
  for (const id of ['repair-auto-option', 'repair-hand-option']) {
    const stage = within(within(baseElement).getByTestId(id)).getByTestId('planet-preview');
    await waitFor(() => expect(stage.getAttribute('aria-busy')).toBeNull());
  }
  const hand = pictures.calls.filter((c) => holdsSaved(c.state, report));
  const auto = pictures.calls.filter((c) => !holdsSaved(c.state, report));
  expect(hand.length).toBeGreaterThan(0);
  expect(auto.length).toBeGreaterThan(0);
  return { hand: hand.at(-1)!, auto: auto.at(-1)! };
}

describe('the repair pictures\' flags', () => {
  for (const file of FIXTURES) {
    it(`are the hand repair's own flags, object for object and footprint for footprint (${file})`, async () => {
      const report = await askRepair(file);
      const { hand } = await choicePictures(report);
      const pictured = hand.options.flagged ?? [];
      repairByHand();
      const live = shown.at(-1) ?? [];
      expect(live.length).toBeGreaterThan(0);
      expect(marks(pictured)).toEqual(marks(live));
    });

    it(`flag on the automatic picture what the plan removes and what it leaves against the rules (${file})`, async () => {
      const report = await askRepair(file);
      const { auto } = await choicePictures(report);
      const pictured = auto.options.flagged ?? [];
      const removed = new Set(report.plan.moves.filter((m) => m.proposal.kind === 'no-place').map((m) => m.id));
      const landed = report.plan.moves.filter((m) => m.proposal.kind !== 'no-place').map((m) => m.id);
      repairAutomatically();
      const state = useEditorStore.getState().gridState!;
      const left = unresolved(state, createDefaultRegistry(), landed).map((id) => state.objects.get(id)!);
      const expected = [...report.objects.filter((o) => removed.has(o.object.id)).map((o) => o.object), ...left];
      expect(marks(pictured)).toEqual(marks(expected));
    });
  }
});
