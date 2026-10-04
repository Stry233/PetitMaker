import * as THREE from 'three';
import { mapFrame } from '../../../core/model/map-chunks';
import type { MapTemplate } from '../../../core/model/types';
import { mapCenterOffset, SEA_FADE_CELLS } from '../core/coords';

/** Fade inside the outer sea chunks, with an elliptical falloff where two edges meet. */
export function softenSeaEdge(material: THREE.Material, template: MapTemplate): void {
  const frame = mapFrame(template), offset = mapCenterOffset(template.width, template.height);
  const bounds = new THREE.Vector4(
    frame.x - offset.x, frame.y - offset.z,
    frame.x + frame.width - offset.x, frame.y + frame.height - offset.z,
  );
  const widths = new THREE.Vector4(
    Math.min(SEA_FADE_CELLS, -frame.x), Math.min(SEA_FADE_CELLS, -frame.y),
    Math.min(SEA_FADE_CELLS, frame.x + frame.width - template.width),
    Math.min(SEA_FADE_CELLS, frame.y + frame.height - template.height),
  ).max(new THREE.Vector4(0.001, 0.001, 0.001, 0.001));
  bounds.x += widths.x; bounds.y += widths.y;
  bounds.z -= widths.z; bounds.w -= widths.w;
  const compile = material.onBeforeCompile.bind(material);
  const programKey = material.customProgramCacheKey();
  material.transparent = true;
  material.depthWrite = false;
  material.customProgramCacheKey = () => `${programKey}|sea-edge`;
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    shader.uniforms.uSeaInner = { value: bounds };
    shader.uniforms.uSeaWidths = { value: widths };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSeaXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeaXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSeaXZ;\nuniform vec4 uSeaInner;\nuniform vec4 uSeaWidths;')
      .replace('#include <alphatest_fragment>', [
        'vec2 seaOutside = max( ( uSeaInner.xy - vSeaXZ ) / uSeaWidths.xy, ( vSeaXZ - uSeaInner.zw ) / uSeaWidths.zw );',
        'diffuseColor.a *= 1.0 - smoothstep( 0.0, 1.0, length( max( seaOutside, vec2( 0.0 ) ) ) );',
        '#include <alphatest_fragment>',
      ].join('\n'));
  };
}
