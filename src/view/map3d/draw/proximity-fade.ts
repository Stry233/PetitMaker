import * as THREE from 'three';

const FADE_START = 3.5;
const FADE_END = 1.1;

/** Parts in one fade group discard the same screen pixels, keeping their interiors hidden. */
export function addProximityFade(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFadeDist;\nattribute vec4 aObjFade;')
      .replace('#include <project_vertex>', [
        '#include <project_vertex>',
        '\t#ifdef USE_INSTANCING',
        '\t\tvec3 fadeOrigin = ( modelViewMatrix * instanceMatrix * vec4( aObjFade.xyz, 1.0 ) ).xyz;',
        '\t\tfloat fadeScale = max( length( instanceMatrix[0].xyz ), max( length( instanceMatrix[1].xyz ), length( instanceMatrix[2].xyz ) ) );',
        '\t#else',
        '\t\tvec3 fadeOrigin = ( modelViewMatrix * vec4( aObjFade.xyz, 1.0 ) ).xyz;',
        '\t\tfloat fadeScale = max( length( modelMatrix[0].xyz ), max( length( modelMatrix[1].xyz ), length( modelMatrix[2].xyz ) ) );',
        '\t#endif',
        // PERSISTENT_GROUND: a negative radius never fades.
        '\tvFadeDist = ( aObjFade.w < 0.0 ) ? 1e6 : length( fadeOrigin ) - aObjFade.w * fadeScale;',
      ].join('\n'));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFadeDist;')
      .replace('#include <clipping_planes_fragment>', [
        `float fadeK = smoothstep( ${FADE_END.toFixed(2)}, ${FADE_START.toFixed(2)}, vFadeDist );`,
        'if ( fadeK < 0.999 ) {',
        // interleaved-gradient noise: a stable per-pixel ordered dither
        '\tfloat fadeDither = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );',
        '\tif ( fadeK <= fadeDither ) discard;',
        '}',
        '#include <clipping_planes_fragment>',
      ].join('\n'));
  };
}


/** The fade radius of a vertex on a persistent ground surface. A floor the camera stands over never
 *  dissolves; the camera's ground clearance keeps the camera out of it instead. */
export const PERSISTENT_GROUND = -1;

/** Mark every vertex of a flat ground surface as persistent ground. */
export function markPersistentGround(geo: THREE.BufferGeometry): void {
  const count = geo.getAttribute('position').count;
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) data[i * 4 + 3] = PERSISTENT_GROUND;
  geo.setAttribute('aObjFade', new THREE.BufferAttribute(data, 4));
}

/** Unpartitioned objects share one origin and radius across all their vertices. */
export function ensureFadeRadius(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute('aObjFade')) return;
  const pos = geo.getAttribute('position');
  if (!pos) return;
  let maxR = 0;
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (d > maxR) maxR = d;
  }
  const data = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) data[i * 4 + 3] = maxR;
  geo.setAttribute('aObjFade', new THREE.BufferAttribute(data, 4));
}
