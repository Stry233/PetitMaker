/** The Help Center's questions-and-answers scene. */
import { TerrainType } from '../../../../core/model/types';
import { stroke, row, INTERIOR, type HelpScene } from './common';


const faq: HelpScene = {
  stage: INTERIOR,
  strip: { kind: 'tools', active: 'rect', surface: 'water' },
  run: ({ world }) => {
    world.beginStroke();
    world.paint([{ x: 67, y: 101 }, { x: 71, y: 101 }], TerrainType.Mountain, 1);
    world.commit();
    const capped = row(101, 68, 70);
    const uncapped = [{ x: 72, y: 101 }, { x: 73, y: 101 }];
    return [
      { move: { strip: 0 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'draw', dur: 500 },
      { press: false, capKey: 'help.fig.faq_1', move: [68, 101], pointer: 'water', dur: 500 },
      { press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      { move: [70, 101], dur: 600, during: stroke(capped, TerrainType.Water, 1) },
      { press: false, dur: 500, on: ({ world: w }) => { w.commit(); } },
      { capKey: 'help.fig.faq_2', move: [72, 101], dur: 500 },
      { press: true, dur: 160, on: ({ world: w }) => w.beginStroke() },
      { move: [73, 101], dur: 450, during: stroke(uncapped, TerrainType.Water, 1) },
      {
        press: false, realToast: true, capKey: 'help.fig.faq_3', dur: 1600,
        on: ({ world: w }) => { w.commit(); },
      },
      { toastKey: null, dur: 600 },
    ];
  },
};


export const MISC_SCENES: Record<string, HelpScene> = { faq };
