/**
 * The reference grid and chunk bounds draped onto the terrain by its material's shader, and the
 * layer-number labels fading on the same density window. Toggling either is one uniform write.
 */
import * as THREE from 'three';
import type { MapTemplate } from '../../../core/model/types';
import { mapChunkOrigin, mapFrame } from '../../../core/grid/map-chunks';
import { CHUNK_SIZE } from '../../../core/game/profile';
import { CELL_GRID_STYLE, CHUNK_GRID_STYLE } from '../../shared/grid/reference-grid';
import { SEA_Y, mapCenterOffset } from '../geometry/coords';

/** Shared uniforms for the draped reference grid (one set, referenced by the terrain material's
 *  injected shader so toggling is a single `.value` write). */
export interface GridUniforms {
  uGrid: { value: number };
  uChunks: { value: number };
  uGridOff: { value: THREE.Vector2 };
  uChunkOrigin: { value: THREE.Vector2 };
  uChunkEnd: { value: THREE.Vector2 };
  uGridPixelRatio: { value: number };
}

/** World-space grid lines follow upward terrain faces and remain occluded by placed objects.
 *  Derivatives enforce a CSS-pixel minimum width; chunk strokes also grow with the cell size.
 *  Both views use white cell lines and black dashed chunk boundaries. */
export function addGridOverlay(mat: THREE.Material, u: GridUniforms): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrid = u.uGrid;
    shader.uniforms.uChunks = u.uChunks;
    shader.uniforms.uGridOff = u.uGridOff;
    shader.uniforms.uChunkOrigin = u.uChunkOrigin;
    shader.uniforms.uChunkEnd = u.uChunkEnd;
    shader.uniforms.uGridPixelRatio = u.uGridPixelRatio;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGridW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    const K = CHUNK_SIZE.toFixed(1);
    const halfWidth = CHUNK_GRID_STYLE.map3d.widthPx / 2;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridW;\nuniform float uGrid;\nuniform float uChunks;\nuniform vec2 uGridOff;\nuniform vec2 uChunkOrigin;\nuniform vec2 uChunkEnd;\nuniform float uGridPixelRatio;')
      .replace('#include <fog_fragment>', [
        '#include <fog_fragment>',
        'if ( uGrid > 0.5 || uChunks > 0.5 ) {',
        '\tvec3 gfn = normalize( cross( dFdx( vGridW ), dFdy( vGridW ) ) );',
        '\tvec2 gc = vGridW.xz + uGridOff;',
        '\tbool inFrame = all( greaterThanEqual( gc, uChunkOrigin ) ) && all( lessThanEqual( gc, uChunkEnd ) );',
        `\tif ( gfn.y > 0.5 && vGridW.y >= ${(SEA_Y - 1e-5).toFixed(5)} && inFrame ) {`, // exclude walls and the sea floor
        '\t\tvec2 cellStep = max( fwidth( gc ), vec2( 1e-5 ) );',
        '\t\tfloat cellPixels = 1.0 / ( max( cellStep.x, cellStep.y ) * uGridPixelRatio );',
        '\t\tfloat ink = 0.0;',
        '\t\tfloat whiteClearance = 1.0;',
        '\t\tif ( uChunks > 0.5 ) {',
        `\t\t\tvec2 kc = ( gc - uChunkOrigin ) / ${K};`,
        '\t\t\tvec2 dk = abs( fract( kc - 0.5 ) - 0.5 ) / max( fwidth( kc ), vec2( 1e-5 ) );',
        `\t\t\tvec2 halfWidth = max( vec2( ${halfWidth} * uGridPixelRatio ), vec2( ${CHUNK_GRID_STYLE.minCellWidth / 2} ) / cellStep );`,
        `\t\t\thalfWidth = min( halfWidth, vec2( ${CHUNK_GRID_STYLE.map3d.maxCellWidth / 2} ) / cellStep );`,
        '\t\t\tvec2 chunkLine = 1.0 - smoothstep( halfWidth - 0.5, halfWidth + 0.5, dk );',
        // Keep the outer stroke inside the grid so it remains complete at the sea edge.
        '\t\t\tvec2 edge = min( gc - uChunkOrigin, uChunkEnd - gc ) / cellStep;',
        '\t\t\tchunkLine = max( chunkLine, 1.0 - smoothstep( 2.0 * halfWidth - 0.5, 2.0 * halfWidth + 0.5, edge ) );',
        `\t\t\tvec2 phase = abs( mod( gc - uChunkOrigin + ${((CHUNK_GRID_STYLE.dashCells + CHUNK_GRID_STYLE.gapCells) / 2).toFixed(1)}, vec2( ${(CHUNK_GRID_STYLE.dashCells + CHUNK_GRID_STYLE.gapCells).toFixed(1)} ) ) - ${((CHUNK_GRID_STYLE.dashCells + CHUNK_GRID_STYLE.gapCells) / 2).toFixed(1)} );`,
        `\t\t\tvec2 dash = 1.0 - smoothstep( vec2( ${CHUNK_GRID_STYLE.dashCells / 2} ) - cellStep * 0.5, vec2( ${CHUNK_GRID_STYLE.dashCells / 2} ) + cellStep * 0.5, phase );`,
        `\t\t\tink = max( chunkLine.x * dash.y, chunkLine.y * dash.x ) * ${CHUNK_GRID_STYLE.map3d.opacity};`,
        // White lines remain in dash gaps but cannot tint the translucent reference ink.
        '\t\t\twhiteClearance = ink > 0.0 ? 0.0 : 1.0;',
        '\t\t}',
        '\t\tif ( uGrid > 0.5 ) {',
        `\t\t\tfloat cellFade = smoothstep( ${CELL_GRID_STYLE.map3d.fadePx[0].toFixed(1)}, ${CELL_GRID_STYLE.map3d.fadePx[1].toFixed(1)}, cellPixels );`,
        `\t\t\tfloat subFade = smoothstep( ${CELL_GRID_STYLE.map3d.subFadePx[0].toFixed(1)}, ${CELL_GRID_STYLE.map3d.subFadePx[1].toFixed(1)}, cellPixels );`,
        `\t\t\tfloat cellHalf = ${(CELL_GRID_STYLE.map3d.widthPx / 2).toFixed(3)} * uGridPixelRatio;`,
        `\t\t\tfloat subHalf = ${(CELL_GRID_STYLE.subWidthPx / 2).toFixed(3)} * uGridPixelRatio;`,
        '\t\t\tvec2 dc = abs( fract( gc - 0.5 ) - 0.5 ) / cellStep;',
        '\t\t\tvec2 ds = abs( fract( gc ) - 0.5 ) / cellStep;',
        '\t\t\tfloat cellLine = 1.0 - smoothstep( cellHalf - 0.5, cellHalf + 0.5, min( dc.x, dc.y ) );',
        '\t\t\tfloat subLine = 1.0 - smoothstep( subHalf - 0.5, subHalf + 0.5, min( ds.x, ds.y ) );',
        `\t\t\tfloat whiteInk = max( cellLine * cellFade * ${CELL_GRID_STYLE.map3d.opacity}, subLine * subFade * ${CELL_GRID_STYLE.map3d.subOpacity} );`,
        '\t\t\tgl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 1.0 ), whiteInk * whiteClearance );',
        '\t\t}',
        '\t\tif ( uChunks > 0.5 ) {',
        // Composite the reference ink independently so its opacity survives the sea's edge fade.
        '\t\t\tfloat combinedAlpha = gl_FragColor.a + ink * ( 1.0 - gl_FragColor.a );',
        '\t\t\tgl_FragColor.rgb *= gl_FragColor.a * ( 1.0 - ink ) / max( combinedAlpha, 1e-5 );',
        '\t\t\tgl_FragColor.a = combinedAlpha;',
        '\t\t}',
        '\t}',
        '}',
      ].join('\n'));
  };
}

/** Layer numbers follow the white cell grid's density fade in CSS pixels. */
export function addLabelFade(mat: THREE.Material, pixelRatio: GridUniforms['uGridPixelRatio']): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGridPixelRatio = pixelRatio;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLblW;\nuniform float uGridPixelRatio;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLblW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLblW;\nuniform float uGridPixelRatio;')
      .replace('#include <opaque_fragment>', [
        '#include <opaque_fragment>',
        'float lfw = max( fwidth( vLblW.x ), fwidth( vLblW.z ) );', // cell-units per pixel (== grid gfw)
        `gl_FragColor.a *= smoothstep( ${CELL_GRID_STYLE.map3d.fadePx[0].toFixed(1)}, ${CELL_GRID_STYLE.map3d.fadePx[1].toFixed(1)}, 1.0 / max( lfw * uGridPixelRatio, 1e-5 ) );`,
      ].join('\n'));
  };
}

export function createGridUniforms(): GridUniforms {
  return {
    uGrid: { value: 0 }, uChunks: { value: 0 },
    uGridOff: { value: new THREE.Vector2() }, uChunkOrigin: { value: new THREE.Vector2() },
    uChunkEnd: { value: new THREE.Vector2() },
    uGridPixelRatio: { value: 1 },
  };
}

/** Aligns the drape to the map's macro cells and chunk frame, and seeds the live toggles. */
export function alignGridUniforms(u: GridUniforms, template: MapTemplate, shown: { grid: boolean; chunks: boolean }): void {
  const goff = mapCenterOffset(template.width, template.height);
  u.uGridOff.value.set(goff.x, goff.z);
  const origin = mapChunkOrigin(template);
  u.uChunkOrigin.value.set(origin.x, origin.y);
  const frame = mapFrame(template);
  u.uChunkEnd.value.set(frame.x + frame.width, frame.y + frame.height);
  u.uGrid.value = shown.grid ? 1 : 0;
  u.uChunks.value = shown.chunks ? 1 : 0;
}
