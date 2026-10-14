import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { serialize } from '../../../io/save/json-codec';
import { deserialize } from '../../_support/save-file';
import { getMapTemplate } from '../../../config/maps';
import { makeState, makeExecutor } from '../../_support/map-state';
import { CommandType, TerrainType, type Command } from '../../../core/model/types';
import { ProvSource, hasFlag, TaintFlag } from '../../../core/provenance/types';

describe('save/load provenance', () => {
  it('persists AI taint across serialize → deserialize', () => {
    const s = makeState(8, 8);
    const e = makeExecutor(s);
    const start = e.beginStroke();
    e.transaction({ source: { source: ProvSource.AiWrite } },
      () => e.execute({ type: CommandType.PaintTerrain, cells: [{ x: 2, y: 2 }], terrainType: TerrainType.Mountain, elevation: 1 } as Command),
    );
    start.commit();
    const json = serialize(s);
    const restored = deserialize(json, s.template);
    expect(restored.provenance!.cellTaint[2]![2]!.contribution.ai).toBe(1);
  });

  it('legacy save without provenance loads with existing content marked Unknown', () => {
    const raw = readFileSync('src/__tests__/fixtures/saves/legacy-v1-no-provenance.json', 'utf8');
    const parsed = JSON.parse(raw) as { templateId?: string };
    const restored = deserialize(raw, getMapTemplate(parsed.templateId));
    // at least one content cell exists and is flagged `UNKNOWN`
    let found = false;
    for (const row of restored.provenance!.cellTaint) for (const t of (row ?? [])) if (t && hasFlag(t.flags, TaintFlag.UNKNOWN)) found = true;
    expect(found).toBe(true);
  });
});
