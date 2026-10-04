import type { Material } from 'three';

/** Ease the road's interpolated feather at both the transparent edge and opaque interior. */
export function softenRoadEdge(material: Material): void {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.a = smoothstep( 0.0, 1.0, diffuseColor.a );',
    );
  };
  material.customProgramCacheKey = () => 'road-edge';
}
