/** A scene world read back from the figure cache is the world a fresh run builds: the designed
 *  neighbourhood is the same on every run, and the stored form survives IndexedDB's structured
 *  clone with nothing lost, so a figure built from it starts exactly where a fresh one does. */
import { describe, expect } from 'vitest';
import { SandboxWorld } from '../../../editor/sandbox/demo-world';
import { sceneNeighbourhood, scenePlot } from '../../../editor/sandbox/neighbourhood';
import { __setSceneCacheIdentity } from '../../../editor/sandbox/scene-worlds';
import { restoredWorld, storedWorld } from '../../../editor/sandbox/stored-world';
import { HELP_SCENES, sceneWorld, type HelpScene } from '../../../ui/help/figures/scenes';
import { CABIN, CABIN2 } from '../../../ui/help/figures/scenes/common';
import { spec } from '../../_support/spec';

const scenes = Object.values(HELP_SCENES);
const plotted = scenes.find((s) => s.plot)!;
const notes = scenes.find((s) => s.notesOnly)!;

/** The objects as the map shows them: every field but the id, which each session mints afresh
 *  (`object-id.ts`) and a map never shows. */
function shown(state: SandboxWorld['state']): unknown[] {
  return [...state.objects.values()].map(({ id: _id, ...rest }) => rest)
    .sort((p, q) => JSON.stringify(p).localeCompare(JSON.stringify(q)));
}

/** The world a scene starts in, built by the generator in a fresh cache. */
function freshWorld(scene: HelpScene): SandboxWorld {
  __setSceneCacheIdentity(null);
  return sceneWorld(scene);
}

describe('scene world cache', () => {
  spec('UI-65', 'every visit builds the same neighbourhood and cleared plot', () => {
    const a = freshWorld(plotted).state;
    const b = freshWorld(plotted).state;
    expect(b.cells).toStrictEqual(a.cells);
    expect(shown(b)).toStrictEqual(shown(a));
  });

  for (const [name, scene] of [['a plotted scene', plotted], ['a notes scene', notes]] as const) spec('UI-64', `a stored world of ${name} restores to the fresh world`, () => {
    const fresh = freshWorld(scene);
    const kept = restoredWorld(scene.template, structuredClone(storedWorld(fresh.state)));
    const read = new SandboxWorld(scene.template, { base: kept });
    expect(read.state.template).toBe(fresh.state.template);
    expect(read.state).toStrictEqual(fresh.state);
  });

  spec('UI-65', "the worker's build, posted and restored, stands the same world as one built here", () => {
    const fresh = freshWorld(plotted).state;
    // What `scene-world.worker.ts` posts for the scene's plot, through the structured clone a post makes.
    const { x1, y1, x2, y2 } = plotted.plot!;
    const base = sceneNeighbourhood(plotted.template);
    const cleared = scenePlot(base, { cells: { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 }, free: [CABIN, CABIN2] });
    const posted = structuredClone({ base: storedWorld(base), plot: storedWorld(cleared) });
    const read = new SandboxWorld(plotted.template, { base: restoredWorld(plotted.template, posted.plot) }).state;
    expect(read.cells).toStrictEqual(fresh.cells);
    expect(shown(read)).toStrictEqual(shown(fresh));
  });
});
