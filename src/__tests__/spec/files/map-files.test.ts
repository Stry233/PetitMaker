/** A map exported as a JSON file and opened again through Import, as a person moves it. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { createGridState } from '../../../core/model/template';
import { placeObjectCommand } from '../../../core/model/command-build';
import { candidateObject } from '../../../tools/objects';
import { getCatalogItem } from '../../../state/catalog';
import { createExecutor } from '../../../state/executor';
import { createDefaultRegistry } from '../../../rules';
import { listPlanets } from '../../../io/storage/planet-library';
import { planetFixture } from '../../_support/planet';
import { builtMap, exportJson, importToasts, inspect, installInto, preview, seen } from './_files';
import { translateFor } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';

describe('map files', () => {
  spec('FILE-01', 'opens an exported map as the same map, with its notes, title and description', async () => {
    const w = builtMap();
    w.state.notes = { title: 'Orchard', description: 'Two apple trees by the hill' };
    const file = exportJson(w.state, ['annotations', 'notes']);
    const { preview: opened } = await preview(file);
    expect(seen(opened.state)).toBe(seen(w.state));
    expect(opened.state.annotations?.items).toEqual(w.state.annotations!.items);
    expect(opened.notes).toEqual({ title: 'Orchard', description: 'Two apple trees by the hill' });

    const withoutNotes = (await preview(exportJson(w.state, ['annotations']))).preview;
    expect(seen(withoutNotes.state)).toBe(seen(w.state));
    expect(withoutNotes.notes).toBeUndefined();
  });

  spec('FILE-02', 'records only the name of a built-in planet and carries a custom planet whole', async () => {
    const builtIn = JSON.parse(exportJson(builtMap('tafa').state)) as Record<string, unknown>;
    expect(builtIn.templateId).toBe('tafa');
    expect(builtIn).not.toHaveProperty('template');

    const planet = planetFixture();
    const state = createGridState(planet);
    const tree = candidateObject(getCatalogItem('tree-apple')!, { x: 38, y: 26 }, 0, state, { id: 'tree' });
    expect(createExecutor(state, createDefaultRegistry()).execute(placeObjectCommand(tree)).success).toBe(true);
    const file = exportJson(state);
    expect(JSON.parse(file)).toHaveProperty('template');
    expect(listPlanets()).toEqual([]);
    const { preview: opened } = await preview(file);
    expect(opened.state.template.id).toBe(planet.id);
    expect(opened.state.template.zones).toEqual(planet.zones);
    expect(seen(opened.state)).toBe(seen(state));
  });

  spec('FILE-29', 'shows an imported map before it replaces the open one, and installs it only when confirmed', async () => {
    const w = builtMap();
    w.state.notes = { title: 'Orchard', description: 'Two apple trees by the hill' };
    const { deps, installed } = installInto();
    const inspection = await preview(exportJson(w.state, ['annotations', 'notes']));
    expect(seen(inspection.preview.state)).toBe(seen(w.state));
    expect(inspection.preview.notes).toEqual(w.state.notes);
    expect(installed.state).toBeNull();
    inspection.commit(deps);
    expect(installed.state).toBe(inspection.preview.state);
  });

  spec('FILE-04', 'restores the step history, locked layers and cameras a file carries, and opens without a section it cannot restore', async () => {
    const blank = seen(builtMapStart());
    const w = builtMap();
    const camera = { view2d: { x: 40, y: -12, zoom: 1.5 }, view3d: { az: 30, el: 25, dist: 0.6, tx: 2, tz: -3 } };
    const file = exportJson(w.state, ['annotations', 'history', 'session'], {
      history: { entries: w.sandbox.executor.getUndoEntries(), depth: 'all' },
      session: { lockedLayers: [1], camera },
    });
    const inspection = await preview(file);
    const { deps, installed } = installInto();
    expect(inspection.commit(deps)).toMatchObject({ status: 'imported', warnings: [] });
    expect(installed.locked).toEqual([1]);
    expect(installed.camera).toEqual(camera);
    const { executor, state } = installed;
    let undone = 0;
    while (executor!.undo()) undone++;
    expect(undone).toBeGreaterThan(0);
    expect(seen(state!)).toBe(blank);
    for (let i = 0; i < undone; i++) executor!.redo();
    expect(seen(state!)).toBe(seen(w.state));

    const damaged = JSON.parse(file) as { session: { v: number } };
    damaged.session.v = 99;
    const second = await preview(JSON.stringify(damaged));
    const outcome = second.commit(installInto().deps);
    expect(outcome.status).toBe('imported');
    expect(outcome.status === 'imported' && outcome.warnings).toContainEqual({ kind: 'dropped-section', section: 'session' });
    expect(seen(second.preview.state)).toBe(seen(w.state));
    expect(importToasts(outcome).map((t) => t.text)).toContain(translateFor('en', 'import.warn_section', { section: translateFor('en', 'export.json_session') }));
  });

  spec('FILE-05', 'opens a pretty-printed and a compact export of one map as the same map', async () => {
    const w = builtMap();
    const compact = exportJson(w.state, ['annotations'], { pretty: false });
    const pretty = exportJson(w.state, ['annotations'], { pretty: true });
    expect(pretty).not.toBe(compact);
    const a = (await preview(compact)).preview;
    const b = (await preview(pretty)).preview;
    expect(seen(a.state)).toBe(seen(b.state));
    expect(a.state.annotations).toEqual(b.state.annotations);
  });

  spec('FILE-06', 'warns that a file edited after export may not match, and opens a file without a code silently', async () => {
    const w = builtMap();
    const file = JSON.parse(exportJson(w.state, ['annotations', 'notes'], { notes: { title: 'Orchard' } })) as {
      notes: { title: string }; manifest: { integrity?: string };
    };
    const untouched = (await preview(JSON.stringify(file))).commit(installInto().deps);
    expect(untouched).toMatchObject({ status: 'imported', warnings: [] });

    file.notes.title = 'Orchard, edited by hand';
    const edited = await preview(JSON.stringify(file));
    const outcome = edited.commit(installInto().deps);
    expect(outcome).toMatchObject({ status: 'imported', warnings: [{ kind: 'modified-after-export' }] });
    expect(edited.preview.notes?.title).toBe('Orchard, edited by hand');
    expect(importToasts(outcome)).toContainEqual({ text: translateFor('en', 'import.warn_modified'), tone: 'error' });

    delete file.manifest.integrity;
    const unsigned = await inspect(JSON.stringify(file));
    if (unsigned.status !== 'ready') throw new Error(unsigned.status);
    expect(unsigned.commit(installInto().deps)).toMatchObject({ status: 'imported', warnings: [] });
  });
});

/** The planet `builtMap` builds on, before any work. */
function builtMapStart() {
  return createGridState(builtMap().state.template);
}

describe('a section Import could not restore', () => {
  spec('FILE-04', 'is named in the warning as the export window names it, in every language', async () => {
    const w = builtMap();
    const camera = { view2d: { x: 4, y: 2, zoom: 1 }, view3d: { az: 30, el: 25, dist: 0.6, tx: 0, tz: 0 } };
    const file = JSON.parse(exportJson(w.state, ['session'], { session: { lockedLayers: [1], camera } }));
    file.session.v = 99; // a session record no release wrote
    const inspection = await preview(JSON.stringify(file));
    const { deps } = installInto();
    const outcome = inspection.commit(deps);
    expect(outcome.status === 'imported' && outcome.warnings).toContainEqual({ kind: 'dropped-section', section: 'session' });
    const store = useEditorStore.getState();
    const was = store.locale;
    try {
      for (const locale of ['en', 'zh'] as const) {
        store.setLocale(locale);
        const label = translateFor(locale, 'export.json_session');
        const warning = translateFor(locale, 'import.warn_section', { section: label });
        expect(importToasts(outcome).map((t) => t.text)).toContain(warning);
        expect(warning).toContain(label);
        if (locale !== 'en') expect(warning).not.toMatch(/session/);
      }
    } finally {
      store.setLocale(was);
    }
  });
});
