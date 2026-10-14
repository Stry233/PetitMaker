import type { BuildMode } from '../../state/editing/edit-mode';
import modeObject from '../../assets/shell/mode-object/icon.png';
import modeRoad from '../../assets/shell/mode-road/icon.png';
import modeMountain from '../../assets/shell/mode-mountain/icon.png';
import modeWater from '../../assets/shell/mode-water/icon.png';
import modeGenerate from '../../assets/shell/mode-generate/icon.png';
import modeObjectOn from '../../assets/shell/mode-object/icon-pressed.png';
import modeRoadOn from '../../assets/shell/mode-road/icon-pressed.png';
import modeMountainOn from '../../assets/shell/mode-mountain/icon-pressed.png';
import modeWaterOn from '../../assets/shell/mode-water/icon-pressed.png';
import modeGenerateOn from '../../assets/shell/mode-generate/icon-pressed.png';

/** Each build mode's block drawing, resting and pressed: the frame's mode row sizes them, and any
 *  surface that pictures a mode shows the same file. */
export const MODE_ICONS = {
  object: { rest: modeObject, pressed: modeObjectOn },
  road: { rest: modeRoad, pressed: modeRoadOn },
  mountain: { rest: modeMountain, pressed: modeMountainOn },
  water: { rest: modeWater, pressed: modeWaterOn },
  generate: { rest: modeGenerate, pressed: modeGenerateOn },
} as const satisfies Partial<Record<Exclude<BuildMode, null>, { rest: string; pressed: string }>>;
