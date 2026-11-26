/** The save-and-share window's commands: each does what its control does, and a bad value changes nothing. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listCommands, runCommand } from '../../../editor/commands/run';
import { NOTE_LIMITS } from '../../../core/model/notes';
import { DEFAULT_FOOTER } from '../../../io/export/footer-template';
import { openingExportOptions, rememberExportOptions } from '../../../io/export/options-store';
import { attributionUnits } from '../../../state/notes-attribution';
import { createDefaultRegistry } from '../../../rules';
import { MODAL_IDS } from '../../../state/slices/shell';
import { useEditorStore } from '../../../state/store';
import { selectedVersion, versionStore } from '../../../state/stylize-versions';
import { MAX_SHOTS } from '../../../state/shot-list';
import { makeTemplate } from '../../_support/map-state';

const s = () => useEditorStore.getState();
const current = (id: string) => listCommands().find((command) => command.id === id)?.current;

beforeEach(() => {
  s().initMap(makeTemplate(30, 30), createDefaultRegistry());
});

afterEach(() => {
  for (const id of MODAL_IDS) s().setModal(id, false);
  s().setExport3dShots([]);
  versionStore.reset();
  rememberExportOptions({ ...openingExportOptions(), footerTemplate: DEFAULT_FOOTER });
});

describe('the map\'s title and description', () => {
  it('are set as the export fields set them, a field left out staying and an empty one cleared', async () => {
    expect(await runCommand('map.notes', { title: 'Harbour town', description: 'Two piers' })).toMatchObject({ ok: true });
    expect(s().gridState!.notes).toEqual({ title: 'Harbour town', description: 'Two piers' });
    await runCommand('map.notes', { description: 'Three piers' });
    expect(s().gridState!.notes).toEqual({ title: 'Harbour town', description: 'Three piers' });
    expect(current('map.notes')).toBe('title: "Harbour town", description: "Three piers"');
    await runCommand('map.notes', { title: '' });
    expect(s().gridState!.notes).toEqual({ description: 'Three piers' });
  });

  it('are cut to the length the fields hold', async () => {
    await runCommand('map.notes', { title: 'x'.repeat(NOTE_LIMITS.title + 5) });
    expect(s().gridState!.notes?.title).toHaveLength(NOTE_LIMITS.title);
  });

  it('refuse a value that is no text, and the title an imported picture still holds', async () => {
    await runCommand('map.notes', { title: 'Mine' });
    expect(await runCommand('map.notes', { title: 7 })).toMatchObject({ ok: false });
    expect(await runCommand('map.notes', { name: 'x' })).toMatchObject({ ok: false });
    expect(s().gridState!.notes).toEqual({ title: 'Mine' });

    const map = s().gridState!;
    map.imageAttribution = { version: 1, templateId: map.template.id, notes: { title: 'Theirs' }, units: attributionUnits(map) };
    expect(await runCommand('map.notes', { title: 'Mine again' })).toMatchObject({ ok: false });
    expect(s().gridState!.notes).toEqual({ title: 'Mine' });
    expect(await runCommand('map.notes', { description: 'A free field' })).toMatchObject({ ok: true });
    expect(s().gridState!.notes).toEqual({ title: 'Theirs', description: 'A free field' });
  });
});

describe('the share picture\'s footer text', () => {
  it('is remembered with the picture\'s other choices', async () => {
    expect(await runCommand('app.export_image', { footer_text: 'Made by me {fill}{date}' })).toMatchObject({ ok: true });
    expect(openingExportOptions().footerTemplate).toBe('Made by me {fill}{date}');
  });

  it('refuses a tag the footer does not have and a line too long to keep', async () => {
    const before = openingExportOptions().footerTemplate;
    expect(await runCommand('app.export_image', { footer_text: '{date} {weather}' })).toMatchObject({ ok: false });
    expect(await runCommand('app.export_image', { footer_text: 'x'.repeat(401) })).toMatchObject({ ok: false });
    expect(await runCommand('app.export_image', { footer_text: 3 })).toMatchObject({ ok: false });
    expect(openingExportOptions().footerTemplate).toBe(before);
    expect(s().modals.share).toBe(false);
  });
});

describe('the illustration takes', () => {
  const take = () => versionStore.mint({ kind: 'proc', direction: 'aquarelle', image: {} as HTMLImageElement, mapEdit: versionStore.currentMapEdit() })!;

  it('are chosen for the share picture by id, and the map as drawn by its own name', async () => {
    const [first, second] = [take(), take()];
    expect(current('export.illustration')).toBe(second.id);
    expect(await runCommand('export.illustration', { version: first.id })).toMatchObject({ ok: true });
    expect(selectedVersion()).toBe(first);
    expect(current('export.illustration')).toBe(first.id);
    expect(await runCommand('export.illustration', { version: 'original' })).toMatchObject({ ok: true });
    expect(selectedVersion()).toBeNull();
    expect(current('export.illustration')).toBe('original');
  });

  it('refuse a take that is not on the shelf and leave the choice standing', async () => {
    const kept = take();
    expect(await runCommand('export.illustration', { version: 'v99' })).toMatchObject({ ok: false });
    expect(await runCommand('export.illustration', {})).toMatchObject({ ok: false });
    expect(await runCommand('export.illustration', { version: 2 })).toMatchObject({ ok: false });
    expect(selectedVersion()).toBe(kept);
  });

  it('are retired one at a time, the chosen one giving way to the map as drawn', async () => {
    const [first, second] = [take(), take()];
    expect(await runCommand('export.illustration_retire', { version: second.id })).toMatchObject({ ok: true });
    expect(versionStore.getState().versions).toEqual([first]);
    expect(selectedVersion()).toBeNull();
  });

  it('refuse to retire a take that is not there, or the map as drawn', async () => {
    const kept = take();
    expect(await runCommand('export.illustration_retire', { version: 'v99' })).toMatchObject({ ok: false });
    expect(await runCommand('export.illustration_retire', { version: 'original' })).toMatchObject({ ok: false });
    expect(versionStore.getState().versions).toEqual([kept]);
    expect(selectedVersion()).toBe(kept);
  });
});

describe('the 3D card\'s shots', () => {
  it('start from the seeded set, which no surface had to show', async () => {
    const seeded = Number(current('export.shot_add'));
    expect(seeded).toBeGreaterThan(1);
    expect(await runCommand('export.shot_add')).toMatchObject({ ok: true });
    expect(s().export3dShots).toHaveLength(seeded + 1);
    expect(current('export.shot_add')).toBe(seeded + 1);
  });

  it('refuse one more than the card holds', async () => {
    while (s().export3dShots.length < MAX_SHOTS) await runCommand('export.shot_add');
    const full = s().export3dShots;
    expect(await runCommand('export.shot_add')).toMatchObject({ ok: false });
    expect(s().export3dShots).toBe(full);
  });

  it('remove the named shot and keep the others in order', async () => {
    await runCommand('export.shot_add');
    const before = s().export3dShots;
    expect(await runCommand('export.shot_remove', { index: 1 })).toMatchObject({ ok: true });
    expect(s().export3dShots).toEqual(before.filter((_, i) => i !== 1));
  });

  it('refuse a shot that is not there, a bad index and the last shot', async () => {
    await runCommand('export.shot_add');
    const before = s().export3dShots;
    expect(await runCommand('export.shot_remove', { index: before.length })).toMatchObject({ ok: false });
    expect(await runCommand('export.shot_remove', { index: -1 })).toMatchObject({ ok: false });
    expect(await runCommand('export.shot_remove', { index: 1.5 })).toMatchObject({ ok: false });
    expect(await runCommand('export.shot_remove', {})).toMatchObject({ ok: false });
    expect(s().export3dShots).toBe(before);
    while (s().export3dShots.length > 1) await runCommand('export.shot_remove', { index: 0 });
    const last = s().export3dShots;
    expect(await runCommand('export.shot_remove', { index: 0 })).toMatchObject({ ok: false });
    expect(s().export3dShots).toBe(last);
  });
});
