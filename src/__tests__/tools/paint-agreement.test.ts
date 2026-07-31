import { describe, it, expect, beforeEach } from 'vitest';
import {
  CommandType, TerrainType, type Command, type EditorEvents, type GridState, type MacroCoord, type ValidationResult,
} from '../../core/model/types';
import { ELEVATION_MAX } from '../../core/model/constants';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import type { ContentType } from '../../tools/paint/paint-plan';
import type { ToolContext } from '../../tools/types';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { useEditorStore } from '../../state/store';
import { getCatalogItem } from '../../state/catalog';
import { makeState, setTerrain } from '../rules/_helpers';
import { makeToolCtx } from './_tool-ctx';
import { setStoreState } from '../_store';

/**
 * The cursor's refusal badge and the click must answer the same question, and twice they have not:
 * the probe once asked a mountain question for a tile click (and validated water as mountain), and
 * once validated the TOP of an auto-stack while the click only issues its first step, which badged
 * every fresh cell as forbidden under a build floor of 2 or more. Both drifts were invisible to
 * tests that exercised one side at a time.
 *
 * So this test never inspects a plan. It reads the probe's verdict, then RUNS the click through the
 * real CommandExecutor and compares outcomes:
 *   - actionable  => the click must not attempt commands and have them all rejected;
 *   - refused     => the click must not succeed at anything.
 * "The click does nothing at all" satisfies both: a no-op is neither a promise nor a refusal.
 */

const AT: MacroCoord = { x: 5, y: 5 };

interface Situation {
  name: string;
  setup: (state: GridState, exec: CommandExecutor) => void;
}

function placeFixture(exec: CommandExecutor, catalogId: string, at: MacroCoord): void {
  const item = getCatalogItem(catalogId)!;
  exec.execute({
    type: CommandType.PlaceObject,
    timestamp: Date.now(),
    object: {
      id: `fixture-${catalogId}`, catalogId: item.id, position: at,
      rotation: 0, elevation: 0,
    },
    loadValue: item.loadValue,
  });
}

const SITUATIONS: Situation[] = [
  { name: 'fresh ground', setup: () => {} },
  {
    name: 'ground already built to elevation 2',
    setup: (s) => setTerrain(s, AT.x, AT.y, TerrainType.Mountain, 2),
  },
  {
    name: `a stack capped at ELEVATION_MAX (${ELEVATION_MAX})`,
    setup: (s) => setTerrain(s, AT.x, AT.y, TerrainType.Mountain, ELEVATION_MAX),
  },
  {
    name: 'a water cell',
    setup: (s) => setTerrain(s, AT.x, AT.y, TerrainType.Water, 1),
  },
  {
    name: 'a cell already carrying a road coating',
    setup: (_s, e) => placeFixture(e, 'road-dirt', AT),
  },
  {
    name: 'a cell occupied by a building',
    setup: (_s, e) => placeFixture(e, 'building-stall', AT),
  },
  {
    name: 'layer 1 locked',
    setup: (s) => { s.lockedLayers.add(1); },
  },
  {
    name: 'built to elevation 2 with the layer above it locked',
    setup: (s) => {
      setTerrain(s, AT.x, AT.y, TerrainType.Mountain, 2);
      s.lockedLayers.add(3);
    },
  },
];

const CONTENT_TYPES: ContentType[] = ['mountain', 'water', 'tile'];
/** Floor 1 hides the auto-stack drift (there the first step IS the target), so 2 and 3 are here. */
const BUILD_FLOORS = [1, 2, 3];

type Outcome = 'applied' | 'rejected' | 'nothing';

describe('the paint cursor and the paint click answer the same question', () => {
  beforeEach(() => {
    setStoreState({ autoEdgeCut: 'off' });
    useEditorStore.getState().setTileMaterial('dirt');
  });

  for (const contentType of CONTENT_TYPES) {
    for (const floor of BUILD_FLOORS) {
      for (const situation of SITUATIONS) {
        const label = `${contentType} brush at build floor ${floor} on ${situation.name}`;

        it(label, () => {
          const state = makeState(12, 12);
          const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
          situation.setup(state, exec);

          let attempted = 0;
          let applied = 0;
          const ctx: ToolContext = {
            ...makeToolCtx(state, exec, 1, floor),
            executeCommand: (cmd: Command): ValidationResult => {
              attempted++;
              const result = exec.execute(cmd);
              if (result.success) applied++;
              return result;
            },
          };

          const tool = new DrawingTool();
          tool.contentType = contentType;
          tool.mode = 'brush';

          const verdict = tool.canActAt(AT, ctx);
          expect(attempted, `${label}: the probe executed a command; it must only validate`).toBe(0);

          tool.onPointerDown(AT, AT, ctx);
          tool.onPointerUp(AT, AT, ctx);

          const outcome: Outcome = applied > 0 ? 'applied' : attempted > 0 ? 'rejected' : 'nothing';
          const detail = `${label}: the cursor said ${verdict ? 'ACTIONABLE' : 'REFUSED'} but the click `
            + `${outcome} (${applied} of ${attempted} commands applied)`;
          if (verdict) expect(outcome, detail).not.toBe('rejected');
          else expect(outcome, detail).not.toBe('applied');
        });
      }
    }
  }

  it('covers a matrix where the click genuinely does all three things, so agreement is not vacuous', () => {
    // An agreement test over situations that all end in "nothing happened" would pass with either
    // side stubbed out. These are the three outcomes, each from the matrix above.
    const outcomes = new Set<Outcome>();
    for (const contentType of CONTENT_TYPES) {
      for (const situation of SITUATIONS) {
        const state = makeState(12, 12);
        const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
        situation.setup(state, exec);
        let attempted = 0;
        let applied = 0;
        const ctx: ToolContext = {
          ...makeToolCtx(state, exec, 1, 2),
          executeCommand: (cmd: Command): ValidationResult => {
            attempted++;
            const result = exec.execute(cmd);
            if (result.success) applied++;
            return result;
          },
        };
        const tool = new DrawingTool();
        tool.contentType = contentType;
        tool.mode = 'brush';
        tool.onPointerDown(AT, AT, ctx);
        tool.onPointerUp(AT, AT, ctx);
        outcomes.add(applied > 0 ? 'applied' : attempted > 0 ? 'rejected' : 'nothing');
      }
    }
    expect([...outcomes].sort()).toEqual(['applied', 'nothing', 'rejected']);
  });
});
