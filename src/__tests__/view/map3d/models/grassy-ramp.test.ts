import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { modelGeometry, groupModelGeometry } from '../../../../view/map3d/models/build-model';
import { getSpec, modelGroupKey } from '../../../../view/map3d/models/registry';
import { ELEVATION_COLORS } from '../../../../core/model/palette';

describe('grassy ramp', () => {
  it('keeps the grass and soil faces in one closed shell at both quality levels', () => {
    for (const quality of ['full', 'lite'] as const) {
      const geometry = modelGeometry('ramp-grassy', quality)!;
      const positions = geometry.getAttribute('position');
      const edges = new Map<string, number>();
      const vertex = (i: number) => [positions.getX(i), positions.getY(i), positions.getZ(i)]
        .map((v) => v.toFixed(6)).join(',');
      for (let i = 0; i < positions.count; i += 3) {
        for (const [a, b] of [[i, i + 1], [i + 1, i + 2], [i + 2, i]]) {
          const edge = [vertex(a!), vertex(b!)].sort().join('|');
          edges.set(edge, (edges.get(edge) ?? 0) + 1);
        }
      }
      expect(edges.size).toBeGreaterThan(0);
      for (const count of edges.values()) expect(count).toBe(2);
      expect(geometry.boundingBox!.min.y).toBeCloseTo(0);
      expect(geometry.boundingBox!.max.y).toBeCloseTo(1);
    }
  });

  it('uses the shared ground palette for the walkable surface', () => {
    const top = getSpec('ramp-grassy')!.parts.filter((p) => p.terrainGradient);
    expect(top.length).toBeGreaterThan(0);
    for (const part of top) {
      const { vertices, triangles } = part.mesh!;
      for (const [a, b, c] of triangles) {
        const [p, q, r] = [vertices[a]!, vertices[b]!, vertices[c]!];
        const ny = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]);
        expect(ny).toBeGreaterThan(0);
      }
    }
  });
  it('matches both terrain endpoints at every supported upper layer without sharing colours across layers', () => {
    for (const quality of ['full', 'lite'] as const) {
      for (const elevation of Object.keys(ELEVATION_COLORS).map(Number).filter(n => n > 0)) {
        const geometry = groupModelGeometry(modelGroupKey('ramp-grassy', elevation), quality)!;
        expect(geometry).toBe(modelGeometry('ramp-grassy', quality, elevation));
        const positions = geometry.getAttribute('position');
        const normals = geometry.getAttribute('normal');
        const colors = geometry.getAttribute('color');
        for (let i = 0; i < positions.count; i++) {
          if (normals.getY(i) <= 0) continue;
          const y = positions.getY(i);
          const color = new Color(ELEVATION_COLORS[elevation - 1]!).lerp(new Color(ELEVATION_COLORS[elevation]!), y);
          expect(colors.getX(i)).toBeCloseTo(color.r);
          expect(colors.getY(i)).toBeCloseTo(color.g);
          expect(colors.getZ(i)).toBeCloseTo(color.b);
        }
      }
    }
    expect(modelGeometry('ramp-grassy', 'full', 1)).not.toBe(modelGeometry('ramp-grassy', 'full', 2));
  });

});
