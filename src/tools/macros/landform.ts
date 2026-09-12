import { ELEVATION_MAX } from '../../core/model/constants';
import { TerrainType, type AutoEdgeCut, type MacroCoord } from '../../core/model/types';
import type { MacroContext } from './context';
import type { MacroReport } from './run';
import { TerrainDraft } from './terrain-draft';

export interface MountainFillInput {
  area: readonly MacroCoord[];
  elevation: number;
  trim?: AutoEdgeCut;
  region?: readonly MacroCoord[];
}
function report(draft: TerrainDraft, success: boolean, elevation: number): MacroReport {
  return success ? { peak: elevation } : { code: 'terrain-blocked', blocked: [...draft.blocked.values()] };
}

/** Fill the complete supplied area at one height, including any required support. */
export function fillMountainArea(ctx: MacroContext, input: MountainFillInput): MacroReport {
  const draft = new TerrainDraft(ctx, input.region);
  const elevation = Math.max(1, Math.min(ELEVATION_MAX, input.elevation));
  for (const c of input.area) {
    if (draft.level(c) > elevation || draft.water(c)) draft.refuse(c);
    else draft.set(c, TerrainType.Mountain, elevation);
  }
  return report(draft, input.area.length > 0 && draft.commit(input.trim), elevation);
}
