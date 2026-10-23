/** Share images: the PetitGlyph code a Share Image carries, and the map Import rebuilds from it. */
import { readFileSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { importFromBytes } from '../../../io/share';
import { computeComposition } from '../../../io/export/compose';
import { createGridState } from '../../../core/model/template';
import { placeObjectCommand } from '../../../core/model/command-build';
import { candidateObject } from '../../../tools/objects';
import { getCatalogItem } from '../../../state/catalog';
import { createExecutor } from '../../../state/executor';
import { createDefaultRegistry } from '../../../rules';
import { translateFor } from '../../../i18n/context';
import type { ExportOptions } from '../../../io/export/types';
import { planetFixture } from '../../_support/planet';
import { TerrainType, rect, world } from '../_world';
import { builtMap, importCode, importToasts, seen, shareCode } from './_files';

/** The README island as the author exported it, and the same Standard-size export resized to 1080
 *  pixels tall and saved twice as a lossy JPEG (`fixtures/glyph/README.md`). */
const ORIGINAL = 'docs/media/share-map.png';
const RECOMPRESSED = 'src/__tests__/fixtures/glyph/social-1080-double-jpeg.png';

const reads = new Map<string, ReturnType<typeof importFromBytes>>();

/** Import reading the image at `path`, read once per file. */
async function imported(path: string) {
  if (!reads.has(path)) reads.set(path, importFromBytes(readFileSync(path)));
  const result = await reads.get(path)!;
  if (!result.ok) throw new Error(`refused: ${result.error.code}`);
  return result;
}

describe('share images', () => {
  spec('FILE-08', 'carry the map as it stands and none of the steps that led to it', async () => {
    const stepped = world();
    const at = stepped.openGround(8, 4);
    stepped.stroke(rect(at, 3, 3), TerrainType.Mountain, 1);
    stepped.stroke(rect({ x: at.x + 4, y: at.y }, 3, 3), TerrainType.Mountain, 1);
    stepped.undo();
    stepped.stroke(rect(at, 2, 2), TerrainType.Mountain, 2);

    const direct = world();
    direct.stroke(rect(at, 3, 3), TerrainType.Mountain, 1);
    direct.stroke(rect(at, 2, 2), TerrainType.Mountain, 2);
    expect(seen(direct.state)).toBe(seen(stepped.state));

    const code = await shareCode(stepped.state);
    expect(Buffer.from(code.rgba).equals(Buffer.from((await shareCode(direct.state)).rgba))).toBe(true);
    const result = await importCode(code);
    if (!result.ok) throw new Error(result.error.code);
    expect(seen(result.state)).toBe(seen(stepped.state));
  });

  spec('FILE-21', 'rebuild the exact map with hidden notes, title, description and custom planet, and a Plain Image carries no code', async () => {
    const w = builtMap();
    w.state.annotations!.visible = false;
    w.state.notes = { title: 'Orchard', description: 'Two apple trees by the hill' };
    const result = await importCode(await shareCode(w.state));
    if (!result.ok) throw new Error(result.error.code);
    expect(seen(result.state)).toBe(seen(w.state));
    expect(result.state.annotations).toEqual(w.state.annotations);
    expect(result.state.notes).toEqual(w.state.notes);

    const planet = planetFixture();
    const custom = createGridState(planet);
    const tree = candidateObject(getCatalogItem('tree-apple')!, { x: 38, y: 26 }, 0, custom, { id: 'tree' });
    expect(createExecutor(custom, createDefaultRegistry()).execute(placeObjectCommand(tree)).success).toBe(true);
    const onPlanet = await importCode(await shareCode(custom));
    if (!onPlanet.ok) throw new Error(onPlanet.error.code);
    expect(onPlanet.state.template.id).toBe(planet.id);
    expect(onPlanet.state.template.zones).toEqual(planet.zones);
    expect(seen(onPlanet.state)).toBe(seen(custom));

    const options: ExportOptions = {
      title: '', description: '', preset: 'plain', showBadge: false, layerPreview: false, card3d: false, grid: false,
      annotations: true, footer: false, footerTemplate: '', resolution: 'standard',
    };
    expect(computeComposition(options, 1.2, [], { layerCount: 1 }).codeBand).toBeUndefined();
    expect(computeComposition({ ...options, preset: 'share' }, 1.2, [], { layerCount: 1 }).codeBand).toBeDefined();
  });

  spec('FILE-22', 'import exactly after resizing and two rounds of lossy recompression', async () => {
    const original = await imported(ORIGINAL);
    const recompressed = await imported(RECOMPRESSED);
    expect(seen(recompressed.state)).toBe(seen(original.state));
    expect(recompressed.state.annotations).toEqual(original.state.annotations);
    expect(recompressed.state.notes).toEqual(original.state.notes);
    expect(original.state.objects.size).toBeGreaterThan(1000);
  });

  spec('FILE-25', 'import a code made against another object set and planet template, warning that the result may differ', async () => {
    const result = await imported(ORIGINAL);
    expect(result.warnings).toEqual([{ kind: 'template-drift' }, { kind: 'catalog-drift' }]);
    const shown = importToasts({ status: 'imported', source: 'raster', warnings: result.warnings }).map((t) => t.text);
    expect(shown).toEqual([
      translateFor('en', 'import.success'), translateFor('en', 'import.warn_template'), translateFor('en', 'import.warn_catalog'),
    ]);
  });
});
