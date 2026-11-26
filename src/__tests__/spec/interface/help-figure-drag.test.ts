// @vitest-environment jsdom
/** A Help figure's object drag runs over the figure's own map, whatever the live editor holds. */
import { expect } from 'vitest';
import { spec } from '../../_support/spec';
import { armBlueprint, placeArmedAt, saveBlueprint } from '../../../editor/editing/blueprint';
import { useEditorStore } from '../../../state/store';
import { getCatalogItem } from '../../../state/catalog';
import { candidateObject } from '../../../tools/objects';
import { placeObjectCommand } from '../../../core/model/command-build';
import { world } from '../_world';
import { ROAD, blueprintEditor, open, roads, scene, shift } from '../blueprints/_blueprints';

blueprintEditor();

spec('UI-38', 'a drag in a figure moves the figure\'s object, never the live placement selected', async () => {
  const sc = scene();
  open(sc.w);
  const record = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  if (typeof record === 'string') throw new Error(`refused: ${record}`);
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  expect(useEditorStore.getState().selection.length).toBeGreaterThan(0);
  const live = sc.w.fingerprint();
  const road = roads(sc.w).find((o) => o.position.x >= sc.free.x)!;

  // A figure holding an object under the same id as one of the live placement's.
  const figure = world();
  const at = figure.openGround(6, 3);
  const placed = figure.sandbox.execute(placeObjectCommand(candidateObject(getCatalogItem(ROAD)!, at, 0, figure.state, { id: road.id })));
  expect(placed.success).toBe(true);
  const drag = figure.sandbox.drag(() => [road.id], () => {}, () => {});
  expect(drag.begin(road.id, at)).toBe(true);
  drag.preview(shift(at, 3, 0));
  drag.commit(shift(at, 3, 0));

  expect(sc.w.fingerprint()).toBe(live);
  expect(figure.state.objects.get(road.id)?.position).toEqual(shift(at, 3, 0));
});
