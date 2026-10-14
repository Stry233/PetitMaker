import { Box3, Triangle, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { getSpec } from '../../../../view/map3d/models/registry';

it.each(['ramp-park-steps', 'ramp-retro-steps'])('%s keeps exposed masonry clear of the tread and support surfaces', (id) => {
  const parts = getSpec(id)!.parts;
  const blocks = parts.filter(part => part.shape === 'box').map(part => new Box3(
    new Vector3(part.pos[0] - part.size[0] / 2, part.pos[1], part.pos[2] - part.size[2] / 2),
    new Vector3(part.pos[0] + part.size[0] / 2, part.pos[1] + part.size[1], part.pos[2] + part.size[2] / 2),
  ));
  const facing = parts.filter(part => part.shape === 'mesh');
  expect(facing.length).toBeGreaterThan(0);
  let intersections = 0;
  for (const part of facing) {
    const vertices = part.mesh!.vertices.map(vertex => new Vector3(...vertex)
      .multiply(new Vector3(...part.size)).add(new Vector3(...part.pos)));
    for (const [a, b, c] of part.mesh!.triangles) {
      const triangle = new Triangle(vertices[a], vertices[b], vertices[c]);
      intersections += blocks.filter(block => block.intersectsTriangle(triangle)).length;
    }
  }
  expect(intersections).toBe(0);
});
