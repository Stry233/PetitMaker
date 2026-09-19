/*
 * The inline-art table is a MAPPING, never a second pointer: each control's art must be the very
 * record its owning module draws from, so re-pointing an icon in the owner re-draws the help.
 */
import { describe, expect, it } from 'vitest';
import { inlineArt } from '../../../ui/chrome/modals/help/inline-art';
import { ASSISTANT_BLOCK, GLYPHS, LAYERS_STACK_SRC, MODES, TOP_RIGHT } from '../../../ui/shell/frame';
import { TOOL_CELLS } from '../../../ui/shell/bars/terrain-cells';
import { SMART } from '../../../ui/shell/bars/smart-menu';

describe('help inline art reads the owners\' own records', () => {
  it('the five modes are the mode row\'s own drawings', () => {
    for (const mode of MODES) {
      expect(inlineArt(`mode-${mode.id}`)).toEqual({ kind: 'img', src: mode.src });
    }
  });

  it('the top-right pair and the assistant are the frame\'s own drawings', () => {
    expect(inlineArt('share-btn')).toEqual({ kind: 'img', src: TOP_RIGHT.find((a) => a.id === 'share')!.src, plate: true });
    expect(inlineArt('menu')).toEqual({ kind: 'img', src: TOP_RIGHT.find((a) => a.id === 'menu')!.src, plate: true });
    expect(inlineArt('assistant')).toEqual({ kind: 'img', src: ASSISTANT_BLOCK.src });
  });

  it('the rail buttons are the rail\'s own glyphs, redo the mirrored undo', () => {
    expect(inlineArt('rail-undo')).toEqual({ kind: 'glyph', glyph: GLYPHS.undo });
    expect(inlineArt('rail-redo')).toEqual({ kind: 'glyph', glyph: GLYPHS.undo, flip: true });
    expect(inlineArt('rail-rotate')).toEqual({ kind: 'glyph', glyph: GLYPHS.rotate });
    expect(inlineArt('rail-zoom-in')).toEqual({ kind: 'glyph', glyph: GLYPHS.zoomIn });
    expect(inlineArt('rail-zoom-out')).toEqual({ kind: 'glyph', glyph: GLYPHS.zoomOut });
    expect(inlineArt('rail-hide')).toEqual({ kind: 'glyph', glyph: GLYPHS.hideUi });
    expect(inlineArt('rail-layers')).toEqual({ kind: 'img', src: LAYERS_STACK_SRC, plate: true });
  });

  it('the tool cells and the smart star are the bar\'s own glyphs', () => {
    const tool = (id: string) => TOOL_CELLS.find((c) => c.id === id)!.glyph.mountain;
    expect(inlineArt('brush-free')).toEqual({ kind: 'glyph', glyph: tool('draw') });
    expect(inlineArt('eraser')).toEqual({ kind: 'glyph', glyph: tool('erase') });
    expect(inlineArt('edge-cut')).toEqual({ kind: 'glyph', glyph: tool('trim') });
    expect(inlineArt('brush-line')).toEqual({ kind: 'glyph', glyph: tool('line') });
    expect(inlineArt('brush-curve')).toEqual({ kind: 'glyph', glyph: tool('curve') });
    expect(inlineArt('brush-rect')).toEqual({ kind: 'glyph', glyph: tool('rect') });
    expect(inlineArt('brush-circle')).toEqual({ kind: 'glyph', glyph: tool('circle') });
    expect(inlineArt('smart-build')).toEqual({ kind: 'glyph', glyph: SMART.cellGlyph });
  });

  it('the load disc is drawn, not filed', () => {
    expect(inlineArt('load-disc')).toEqual({ kind: 'disc' });
  });

  it('every [[name]] the shipped copy carries resolves to some art', async () => {
    const { HELP_TABLES, ensureHelpStrings } = await import('../../../i18n/locales/help');
    ensureHelpStrings();
    const names = new Set<string>();
    for (const table of Object.values(HELP_TABLES)) {
      for (const value of Object.values(table)) {
        for (const m of String(value).matchAll(/\[\[([a-z0-9-]+)\]\]/g)) names.add(m[1]!);
      }
    }
    for (const name of names) {
      expect(inlineArt(name), `[[${name}]]`).toBeTruthy();
    }
  });
});
