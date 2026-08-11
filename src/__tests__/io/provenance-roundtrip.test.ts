import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { serialize, deserialize } from '../../io/json-codec';
import { getMapTemplate } from '../../config/maps';
import { makeState } from '../rules/_helpers';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { CommandType, TerrainType, type Command } from '../../core/model/types';
import { ProvSource, hasFlag, TaintFlag } from '../../core/provenance/types';
import { roadLookup } from '../../state/object-index';

describe('save/load provenance', () => {
  it('persists AI taint across serialize → deserialize', () => {
    const s = makeState(8, 8);
    const e = new CommandExecutor(s, new EventBus(), createDefaultRegistry(), roadLookup(s));
    const start = e.getUndoStackSize();
    e.withSource({ source: ProvSource.AiWrite }, () => e.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x: 2, y: 2 }], terrainType: TerrainType.Mountain, elevation: 1 } as Command));
    e.commitStroke(start);
    const json = serialize(s);
    const restored = deserialize(json, s.template);
    expect(restored.provenance!.cellTaint[2]![2]!.contribution.ai).toBe(1);
  });

  it('legacy save without provenance loads with existing content marked Unknown', () => {
    const raw = readFileSync('src/__tests__/io/__fixtures__/legacy-v1-no-provenance.json', 'utf8');
    const parsed = JSON.parse(raw) as { templateId?: string };
    const restored = deserialize(raw, getMapTemplate(parsed.templateId));
    // at least one content cell exists and is flagged UNKNOWN
    let found = false;
    for (const row of restored.provenance!.cellTaint) for (const t of (row ?? [])) if (t && hasFlag(t.flags, TaintFlag.UNKNOWN)) found = true;
    expect(found).toBe(true);
  });
});
