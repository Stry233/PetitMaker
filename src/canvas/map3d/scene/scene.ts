/**
 * ThreeScene — the ONLY GPU-touching module. Builds a three.js scene from a
 * GridState snapshot (terrain + object instances), drives a render-on-demand
 * loop (renders only while the controls move / damping settles), and disposes
 * everything on teardown. Mirrors MapRenderer's lifecycle + requestRender ethos.
 */
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
// Bold Helvetica-derived typeface — matches the 2D legend's bold sans-serif weight.
import helvetikerBold from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { ItemCategory, TerrainType, type GridState, type PlacedObject } from '../../../core/model/types';
import { ELEVATION_MAX } from '../../../core/model/constants';
import { glQuality, maxRenderScale } from '../../../core/runtime/device-quality';
import { solidTopOf } from '../../../core/edge-cut/terrain-silhouette';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { resolveHistoryFlash } from '../../map2d/layers/error-flash';
import { buildChunkTerrain, buildRoadTrimMeshes, type RoadTrimPart } from '../build/terrain-geometry';
import { dirtyChunksFor } from '../build/chunk-dirty';
import { bodyRoute, objectInstance } from '../build/object-meshes';
import { getCatalogItem } from '../../../state/catalog';
import { InstanceSlots } from '../build/instance-slots';
import { visibilityView } from '../build/visibility-view';
import { chunkNumberQuads } from '../build/passive-geometry';
import { chunkNumberCells, setNumberLabelStyle, drawNumberLabel } from '../../map2d/layers/number-cells';
import { waterfallFaceMap } from '../../../core/model/waterfall-geometry';
import { pickSurface, surfaceHeightAt } from '../interaction/pick';
import { animConfig, easeOutBack } from '../../../core/runtime/anim-config';
import { arcMotion, arcOffset, spinOffset, type ArcMotion, type GroupRotation } from '../../group-arc';
import { isMotionReduced } from '../../map2d/motion-state';
import { getCell } from '../../../core/model/grid-model';
import { Overlay3D } from './overlay3d';
import { Annotations3D, type Annotations3DOpts } from './annotations3d';
import type { AnnotationsState } from '../../../core/model/annotations';
import { Projection3D } from '../interaction/projection';
import type { ActiveView, ViewCamera } from '../../view-projection';
import { CommandType } from '../../../core/model/types';
import { cellsAffectedByLayerToggle } from '../../map2d/layers/layer-visibility';
import { CHUNK_SIZE } from '../../../core/model/constants';
import type { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../core/model/types';
import { archetypeGeometry, disposeArchetypes } from '../build/object-archetypes';
import { modelGeometry, disposeModels } from '../models/build-model';
import { introStartOffset, reportedCameraAngle, type CameraAngle } from '../capture';
import { clamp } from '../../../core/model/math';
import { makeCamera, makeControls, frameBounds, type MapBounds } from './camera-controls';
import { CameraInertia } from './camera-inertia';
import { CameraRestDetector } from './camera-rest';
import { layerToY, mapCenterOffset, cellCornerWorld, platformTopY } from '../core/coords';

/** Ease for the camera fly-in (decelerate into the resting frame). */
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
import { iconUrl } from '../../../assets/icon-urls';
import { roadTileCanvas } from '../../road-tile-texture';
import { waterColor } from '../core/palette';
import { iconDominantColor } from './icon-color';
import type { MeshData, ObjectInstance, ArchetypeKey } from '../core/types';

/** One instanced-object group's live scene state (see addObjectInstance). */
interface InstanceGroup {
  mesh: THREE.InstancedMesh;
  capacity: number;
  isModel: boolean;
  geo: THREE.BufferGeometry;
  instances: (ObjectInstance | null)[];
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);

/** One terrain chunk's live scene objects (see rebuildChunk). */
interface TerrainChunk {
  meshes: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  numbers: { mesh: THREE.Mesh; tex: THREE.CanvasTexture } | null;
}

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  // The builders emit sRGB colours; convert to the renderer's LINEAR working
  // space so colour-managed output reproduces them at full (2D-matching) vibrance
  // instead of washing them out. A mesh carrying per-vertex alpha (the road
  // decal's feather) gets a 4-component colour attribute, which is what makes
  // three.js sample the alpha in the shader.
  const stride = m.alpha ? 4 : 3;
  const lin = new Float32Array((m.colors.length / 3) * stride);
  const c = new THREE.Color();
  for (let i = 0, v = 0; i < m.colors.length; i += 3, v++) {
    c.setRGB(m.colors[i]!, m.colors[i + 1]!, m.colors[i + 2]!, THREE.SRGBColorSpace);
    lin[v * stride] = c.r; lin[v * stride + 1] = c.g; lin[v * stride + 2] = c.b;
    if (m.alpha) lin[v * stride + 3] = m.alpha[v]!;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(lin, stride));
  if (m.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
  g.setIndex(m.index);
  if (m.alpha) {
    // The alpha-fading mesh is the flat road decal: its normal is +Y everywhere by construction.
    // Computing normals instead NaNs the vertices whose triangles are all zero-area (a ring
    // segment that does not fade), and each NaN flares its vertex's sample pure white.
    const up = new Float32Array(m.positions.length);
    for (let i = 1; i < up.length; i += 3) up[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  } else {
    g.computeVertexNormals();
  }
  return g;
}

/** Max mountain height present, for camera framing. */
function maxHeight(state: GridState): number {
  let top = 0;
  for (const row of state.cells) {
    for (const cell of row) {
      if (cell?.terrain?.type === TerrainType.Mountain) {
        // a Γ patch's fillet renders at its elevation tier even though its structural support is lower
        top = Math.max(top, cell.terrain.patchOnly ? cell.terrain.elevation : solidTopOf(cell.terrain, TerrainType.Mountain));
      }
    }
  }
  return Math.min(top, ELEVATION_MAX);
}


// Proximity fade: object fragments dissolve (ordered-dither screen door) as they come within
// FADE_START world units of the camera, fully gone inside FADE_END — so pushing the camera into or
// through a building/tree never blacks out the view. Per-FRAGMENT distance, so only the near walls
// of a large building fade while its far side stays visible. Dither-discard (not alpha blending)
// keeps the materials opaque: no transparency sorting artifacts, and it works on InstancedMesh
// without per-instance attributes. Ground DECALS (roads, the plaza platform) keep an un-faded
// material — the floor under the camera shouldn't dissolve.
// View-space distance to the object's NEAREST extent at which the fade starts / completes. Measured
// from the surface (origin distance minus the object's scaled radius), so these are how close the
// camera gets to the object's SKIN, independent of its size.
const FADE_START = 3.5;
const FADE_END = 1.1;

/** Inject the proximity fade into a built-in material via onBeforeCompile. (three's default
 *  customProgramCacheKey — onBeforeCompile.toString() — keeps these programs distinct from the
 *  un-patched terrain/decal materials, so shader caching stays correct.)
 *
 *  The fade distance is per-OBJECT, not per-fragment. A per-fragment distance only dissolves the
 *  near faces while the far faces of the SAME object stay opaque, so you see INTO the model (its
 *  back faces / interior). Here vFadeDist is constant across every vertex of an object, so the whole
 *  object dithers together and at each screen pixel the front and back discard as one — revealing
 *  the scene BEHIND the entire object.
 *
 *  It measures to the object's NEAREST extent: the origin (instance/mesh translation) distance minus
 *  the object's scaled radius (the baked `aObjR` attribute × the per-instance scale). Subtracting the
 *  radius is what makes a LARGE object fade before the camera reaches its middle — the fade keys off
 *  its skin, not its centre. Geometries without `aObjR` read 0 (safe fallback = origin distance). */
function addProximityFade(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFadeDist;\nattribute float aObjR;')
      .replace('#include <project_vertex>', [
        '#include <project_vertex>',
        '\t#ifdef USE_INSTANCING',
        '\t\tvec3 fadeOrigin = ( modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;',
        '\t\tfloat fadeScale = max( length( instanceMatrix[0].xyz ), max( length( instanceMatrix[1].xyz ), length( instanceMatrix[2].xyz ) ) );',
        '\t#else',
        '\t\tvec3 fadeOrigin = ( modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;',
        '\t\tfloat fadeScale = max( length( modelMatrix[0].xyz ), max( length( modelMatrix[1].xyz ), length( modelMatrix[2].xyz ) ) );',
        '\t#endif',
        '\tvFadeDist = length( fadeOrigin ) - aObjR * fadeScale;',
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

/** Where along the cascade pattern a waterfall face is shaded (see shadeFall). */
const FALL_PHASE = 0;

/** Bake the geometry's radius — the max vertex distance from its LOCAL origin — onto every vertex as
 *  the `aObjR` attribute (idempotent). The proximity-fade shader multiplies it by the per-instance
 *  scale to fade from the object's nearest surface (see addProximityFade). */
function ensureFadeRadius(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute('aObjR')) return;
  const pos = geo.getAttribute('position');
  if (!pos) return;
  let maxR = 0;
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (d > maxR) maxR = d;
  }
  geo.setAttribute('aObjR', new THREE.BufferAttribute(new Float32Array(pos.count).fill(maxR), 1));
}

/** Shared uniforms for the draped reference grid (one set, referenced by the terrain material's
 *  injected shader so toggling is a single `.value` write). */
interface GridUniforms { uGrid: { value: number }; uChunks: { value: number }; uGridOff: { value: THREE.Vector2 } }

/** Inject a DRAPED reference grid into the terrain material — a light "texture" painted in the fragment
 *  shader from WORLD XZ, so it follows the terrain surface (never a flat plane floating over it) and
 *  placements drawn on top occlude it normally. Only UP-FACING faces get it (the derivative face normal
 *  gates out the vertical walls); `fwidth` keeps every line a screen-constant ~1px. The macro cell grid +
 *  a fainter half-cell subgrid (uGrid) and the coarse chunk bounds (uChunks) toggle live via the shared
 *  uniforms. Mirrors the 2D grid's colours (white cell/subgrid, black chunk bounds). */
function addGridOverlay(mat: THREE.Material, u: GridUniforms): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrid = u.uGrid;
    shader.uniforms.uChunks = u.uChunks;
    shader.uniforms.uGridOff = u.uGridOff;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGridW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    const K = CHUNK_SIZE.toFixed(1);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridW;\nuniform float uGrid;\nuniform float uChunks;\nuniform vec2 uGridOff;')
      .replace('#include <opaque_fragment>', [
        '#include <opaque_fragment>',
        'if ( uGrid > 0.5 || uChunks > 0.5 ) {',
        '\tvec3 gfn = normalize( cross( dFdx( vGridW ), dFdy( vGridW ) ) );',
        '\tif ( gfn.y > 0.5 ) {', // up-facing surfaces only — the walls stay clean
        '\t\tvec2 gc = vGridW.xz + uGridOff;', // → macro cell coordinates (lines at integers)
        // Density fade: each line is ~1px on screen, so as the map zooms out and a cell shrinks below
        // ~10px that 1px line becomes a large fraction of the cell (and finally washes it) — reading as
        // fat, dense lines. gfw = fwidth(gc) = cell-units per pixel (1/gfw = cell size in px), so fade the
        // grid out well before that: the dense half-cell subgrid first, then the cell grid. The grid is
        // crisp only when cells are comfortably large (zoomed in for editing) and gone at the global view.
        '\t\tfloat gfw = max( fwidth( gc ).x, fwidth( gc ).y );',
        '\t\tfloat subFade = 1.0 - smoothstep( 0.025, 0.07, gfw );',   // subgrid gone by ~14px cells
        '\t\tfloat cellFade = 1.0 - smoothstep( 0.05, 0.11, gfw );',   // cell grid gone by ~9px cells
        '\t\tif ( uGrid > 0.5 ) {',
        '\t\t\tif ( subFade > 0.001 ) {',
        '\t\t\t\tvec2 ds = abs( fract( gc * 2.0 - 0.5 ) - 0.5 ) / max( fwidth( gc * 2.0 ), vec2( 1e-5 ) );',
        '\t\t\t\tgl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 1.0 ), ( 1.0 - min( min( ds.x, ds.y ), 1.0 ) ) * 0.09 * subFade );',
        '\t\t\t}',
        '\t\t\tif ( cellFade > 0.001 ) {',
        '\t\t\t\tvec2 dc = abs( fract( gc - 0.5 ) - 0.5 ) / max( fwidth( gc ), vec2( 1e-5 ) );',
        '\t\t\t\tgl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 1.0 ), ( 1.0 - min( min( dc.x, dc.y ), 1.0 ) ) * 0.18 * cellFade );',
        '\t\t\t}',
        '\t\t}',
        '\t\tif ( uChunks > 0.5 ) {',
        '\t\t\tvec2 dk = abs( fract( gc / ' + K + ' - 0.5 ) - 0.5 ) / max( fwidth( gc / ' + K + ' ), vec2( 1e-5 ) );',
        '\t\t\tgl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.0 ), ( 1.0 - min( min( dk.x, dk.y ) / 0.6, 1.0 ) ) * 0.55 );', // ~0.6px hairline (alpha keeps it readable)
        '\t\t}',
        '\t}',
        '}',
      ].join('\n'));
  };
}

/** Fade the layer-number labels with the SAME density LOD as the draped grid: the
 *  label mesh is in the same world scale as the terrain (1 unit = 1 cell), so
 *  fwidth of its world XZ is cell-units-per-pixel — identical to the grid's gfw.
 *  Using the grid's EXACT cell-grid fade window (0.05..0.11) makes the numbers
 *  appear and fade in lockstep with the cell lines: wherever the grid shows,
 *  the numbers show. Per-pixel, so near chunks stay readable while far ones fade. */
function addLabelFade(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLblW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLblW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLblW;')
      .replace('#include <opaque_fragment>', [
        '#include <opaque_fragment>',
        'float lfw = max( fwidth( vLblW.x ), fwidth( vLblW.z ) );', // cell-units per pixel (== grid gfw)
        'gl_FragColor.a *= 1.0 - smoothstep( 0.05, 0.11, lfw );',    // same window as the grid's cell lines
      ].join('\n'));
  };
}

/** The legend glyph font, parsed once. A typeface font gives real vector outlines, so the labels
 *  are built as flat filled ShapeGeometry (crisp at ANY zoom, never a magnified raster). */
let _legendFont: Font | null = null;
function legendFont(): Font {
  if (!_legendFont) _legendFont = new FontLoader().parse(helvetikerBold as unknown as Parameters<FontLoader['parse']>[0]);
  return _legendFont;
}

/** Flat (no-height) vector geometry for one legend label — filled glyph outlines, centred on the
 *  origin and scaled to a uniform `height` in world units (width follows naturally). Scaling by
 *  HEIGHT, not the max dimension, keeps every label the same visual size — a 2-char label like "10"
 *  is simply wider, not shorter. Being real geometry (not a texture) it stays sharp at any zoom. */
function labelGeometry(text: string, height: number): THREE.ShapeGeometry {
  const geo = new THREE.ShapeGeometry(legendFont().generateShapes(text, 1));
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const s = height / Math.max(bb.max.y - bb.min.y, 1e-3);
  geo.center();
  geo.scale(s, s, 1);
  return geo;
}

const SKY_TOP = '#cfe9fb';   // soft sky blue
const HORIZON = '#dfeede';   // pale green-cream haze where land meets sky (also the fog colour)

/** A vertical sky→horizon gradient as a scene-background texture. */
function gradientTexture(top: string, bottom: string): THREE.Texture {
  const cnv = document.createElement('canvas');
  cnv.width = 2; cnv.height = 256;
  const ctx = cnv.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ThreeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private disposables: { dispose(): void }[] = [];
  private instanced: THREE.InstancedMesh[] = [];
  /** Incremental instancing: per-group meshes with spare capacity, dense slots
   *  (InstanceSlots), and per-slot instance metadata for icon-tint refinement. */
  private groups = new Map<string, InstanceGroup>();
  private slots = new InstanceSlots();
  private roadIds = new Set<string>();
  private objElevation = new Map<string, number>();
  private plops = new Map<string, number>(); // id → start ms
  /** `onFrame`, when supplied, is the selection ring's hook onto this SAME clock (see
   *  `view-projection.ts`'s `EditorView.animateRotation`) — called once per tick with the tween's own
   *  progress, exactly 1 on the settling frame, never under reduced motion (this map stays empty then). */
  private spins = new Map<string, { from: number; to: number; born: number; onFrame?: (eased: number) => void }>(); // degrees
  /** The ONE in-flight group rotation (a rigid body has one clock; a second turn supersedes it).
   *  `onFrame` is the ring's hook, called once per tick (not once per member) with the same progress. */
  private groupArc: {
    born: number; sweepRad: number;
    /** `roadTrim` members have no instance to back-date — their body rides the trimmed-road mesh, so
     *  the tween displaces that mesh for them instead (see isTrimMeshedRoad). */
    members: Array<{ id: string; motion: ArcMotion; spun: boolean; roadTrim: boolean }>;
    hasRoadTrim: boolean;
    onFrame?: (eased: number) => void;
  } | null = null;
  private hiddenLayers: ReadonlySet<number> = new Set();
  /** Object edits arrived while the scene was paused: the deltas were skipped, so the instanced
   *  set no longer matches the map and `resume()` rebuilds it whole (see `resetObjects`). */
  private objectsStale = false;
  private viewCache: GridState | null = null;
  private plazaGroup: THREE.Group | null = null;
  private plazaElevation: number | null = null;
  private overlay3d: Overlay3D | null = null;
  private passive = { grid: false, numbers: false, chunks: false };
  private gridUniforms: GridUniforms = { uGrid: { value: 0 }, uChunks: { value: 0 }, uGridOff: { value: new THREE.Vector2() } };
  private legendGroup: THREE.Group | null = null;
  private legendMat: THREE.MeshBasicMaterial | null = null;
  private arrowGroup = new THREE.Group();
  /** The plan-notes layer's own group; asks arrive through `setAnnotations` and re-drape with the
   *  terrain flush, since its heights are baked into its vertices. */
  private annotations3d = new Annotations3D();
  private editorView: ActiveView | null = null;
  private bus: EventBus<EditorEvents> | null = null;
  /** One mesh per road material present (each wears that material's tile art). */
  private roadTrimMeshes: THREE.Mesh[] = [];
  private roadTrimGeos: THREE.BufferGeometry[] = [];
  private roadTrimMat!: THREE.MeshLambertMaterial;
  /** The per-material road materials, keyed `<catalogId>:tex|flat`. A textured surface's vertex
   *  colours are white, so the stand-in used while the art decodes must carry the item's hex
   *  itself — the two are separate cache entries, and the textured one wins once it exists. */
  private roadTileMats = new Map<string, THREE.MeshLambertMaterial>();
  private sharedMat: THREE.MeshLambertMaterial;
  private modelMat: THREE.MeshLambertMaterial;
  private decalMat: THREE.MeshLambertMaterial;
  private renderWindow = 0;
  private running = true;
  private raf = 0;
  private sun!: THREE.DirectionalLight;
  /** Per-chunk terrain, rebuilt chunk-by-chunk when cells change. */
  private terrainChunks = new Map<string, TerrainChunk>();
  private dirtyTerrain = new Set<string>();
  /** Set by onObjects (below) instead of rebuilding inline: a dab's remove+add churn fires several
   *  objects-changed events, and each road-trim/icon-colour rebuild scans every object on the map —
   *  coalescing to one rebuild per rendered frame is what keeps that scan O(1) per dab rather than
   *  O(events this dab) x O(map objects). */
  private roadTrimDirty = false;
  private iconRefineDirty = false;
  /** Chrome anchored to the map (selection handles, popovers) repaints on `viewport-changed`, and
   *  an object moving under it changes where it belongs. Set by onObjects instead of emitting
   *  there: that emit is the ONE map signal `usePointerInteraction` deliberately answers
   *  IMMEDIATELY rather than per frame (a camera move must not lag the pointer by a frame), so
   *  emitting it per object turned every command into a full pointer re-sample — in 3D, a
   *  heightfield ray-march per command, hundreds of them inside one fast pointermove. */
  private chromeNudgeDirty = false;
  private opaqueMat!: THREE.MeshLambertMaterial;
  private wetMat!: THREE.MeshLambertMaterial;
  private busDetach: (() => void) | null = null;
  private cameraRest = new CameraRestDetector();
  // In-app 4×MSAA: the scene renders into this multisampled target, and a
  // fullscreen copy pass presents the RESOLVED frame (see the renderer options
  // comment for why the canvas must stay single-sample).
  private msaaTarget: THREE.WebGLRenderTarget | null = null;
  private copyScene: THREE.Scene | null = null;
  private copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private fallDeep: [number, number, number] = [0, 0, 0];   // linear deep-water colour
  private fallFoam: [number, number, number] = [1, 1, 1];   // linear foam colour
  // Camera intro fly-in: the WHOLE map glides from a far framing (small in the fog) down to its
  // resting frame, so the atmosphere does the work. introActive gates it; the controls are paused
  // until it finishes.
  private introActive = false;
  private introStartMs = 0;
  private introFrom = new THREE.Vector3();
  private introTo = new THREE.Vector3();
  private introTarget = new THREE.Vector3();
  /** Software-GL profile: no shadows, no MSAA, 1x pixels, no fly-in (see the constructor). */
  private lite = false;
  private contextLost = false;

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    // The frozen shadow map died with the context; recompute it once on the restored one.
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  };

  // Toolkit camera moves (zoom / tilt / fit buttons) glide instead of snapping —
  // a short eased tween of the camera position + orbit target, ticked in the loop.
  // (Wheel/pinch zoom stays instant/responsive; only the buttons tween.)
  private camTween: {
    startMs: number; dur: number;
    fromPos: THREE.Vector3; toPos: THREE.Vector3;
    fromTgt: THREE.Vector3; toTgt: THREE.Vector3;
  } | null = null;

  constructor(private container: HTMLElement, private liveState: GridState, bus?: EventBus<EditorEvents>) {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    // STANDARD depth buffer, deliberately: logarithmicDepthBuffer writes gl_FragDepth
    // per fragment, which collapses every MSAA sample of an edge pixel onto one depth —
    // silhouette edges of small geometry (flowers, posts) then flicker against the
    // background as the camera moves (a "flashing border"). The scene doesn't need log
    // depth: near=0.5 gives ~0.003-unit precision at map-viewing distance, well under
    // the smallest intentional separation (the 0.02 water-rim lift), and objects stand
    // on the visible surface rather than intersecting it.
    // ANTIALIASING IS DONE IN-APP, never on the canvas. Canvas-level MSAA
    // (antialias: true) hands the resolve to the browser's present path, and on
    // Chromium/ANGLE over NVIDIA GL that path is broken two ways: successive
    // presents of an IDENTICAL frame differ at silhouette edges (small models
    // visibly strobe between smooth and aliased at rest), and instanced vertex
    // colors wash out (white flora). Rendering into our own multisampled target
    // (renderFrame) keeps the resolve inside the app's GL command stream, so the
    // canvas presents a pre-resolved single-sample frame every browser handles
    // identically. preserveDrawingBuffer stays off for the same class of reason
    // (recomposites of a kept buffer vs fresh presents differ); capture()
    // renders synchronously immediately before toDataURL, so readback works.
    // alpha: false — the sky background always fills the frame, so the canvas is
    // opaque; an alpha canvas would put the resolved copy pass through the
    // browser's premultiplied-alpha compositing, which mishandles out-of-range
    // colour/alpha combinations (Firefox composites the canvas as fully
    // transparent — a blank preview).
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    // SHADER DIAGNOSTICS ARE A DEVELOPMENT TOOL, and they are not free. The first time three uses a
    // program it fetches the program log and both shader logs synchronously, only to report a
    // compile error; each of those queries forces the driver to finish linking, and on a software
    // rasterizer that costs over a second PER PROGRAM (measured: 1.9s per program on SwiftShader,
    // ~1.2s of it the logs themselves). It is paid again every time a program is rebuilt, so it
    // lands in front of the user — during an orbit, or inside the shadow pass at the first edit.
    // The shaders are build-time constants (three's own, plus this file's string injections), so a
    // link failure is a development bug and dev keeps the reporting. Nothing at runtime reads a
    // shader log: a context that cannot be created and a scene that cannot build toast
    // `view3d.unavailable` from Editor3DCanvas, and a lost context is handled by the listeners below.
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    // On a SOFTWARE rasterizer (glQuality 'lite') every pixel is CPU work: shadow maps and the
    // MSAA target each multiply it, and the reported result is seconds of latency at 100% GPU
    // process. Lite drops both and renders at 1x — a plainer picture that actually moves.
    this.lite = glQuality() === 'lite';
    // maxRenderScale carries the lite tier itself (1x there, ≤2×/≤1.5× on hardware) AND never asks
    // for more pixels than the display has, which a fixed 1 would on a page zoomed below 100%.
    // onResize re-reads it, so the two sites must read the same one thing.
    this.renderer.setPixelRatio(maxRenderScale());
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // keep colours vivid, no filmic desaturation
    this.renderer.shadowMap.enabled = !this.lite;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    if (!this.lite) this.setupMsaaTarget(w, h);
    // A GPU reset (driver crash, process eviction) LOSES the context mid-session. preventDefault
    // is what tells the browser a restore is wanted; rendering pauses meanwhile, and the restore
    // re-opens the render window so the scene repaints instead of staying frozen.
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);

    const sky = gradientTexture(SKY_TOP, HORIZON);
    this.scene.background = sky;
    this.disposables.push(sky);
    this.camera = makeCamera(w / h);
    this.controls = makeControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', this.requestRender);

    this.addLights();
    // Lambert = clean, vibrant diffuse (no PBR roughness desaturation); flat-shaded
    // for the chunky low-poly read; DoubleSide so no face can vanish from any angle.
    this.sharedMat = new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide });
    // Bespoke models bake their own (multi-)colours into vertex colours.
    this.modelMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    // Ground decals (roads, the plaza platform): same look, NO proximity fade.
    this.decalMat = new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide });
    addProximityFade(this.sharedMat);
    addProximityFade(this.modelMat);
    this.disposables.push(this.sharedMat, this.modelMat, this.decalMat);

    this.buildTerrain(this.liveState);
    this.scene.add(this.arrowGroup);
    this.scene.add(this.annotations3d.group);
    this.rebuildWaterfallArrows();
    if (bus) {
      this.bus = bus;
      // Live edit sync: an edit dirties its chunks (+1-cell ring — neighbors'
      // exposed faces and backing change too); the render loop remeshes them.
      const onCells = (data: EditorEvents['cells-changed']) => {
        this.viewCache = null;
        const { width, height } = this.liveState.template;
        for (const k of dirtyChunksFor(data.cells, width, height)) this.dirtyTerrain.add(k);
        // The buildable drape is baked at each cell's SURFACE HEIGHT, so terrain moving under a
        // painted region leaves it describing ground that is gone — a generation's old elevations,
        // standing until the region happened to be shown again.
        this.buildableDirty = true;
        this.requestRender();
      };
      const onObjects = (data: EditorEvents['objects-changed']) => {
        // A paused scene (the 2D view standing over this one) mirrors nothing per object: a road
        // fill is thousands of these events, and instancing them into meshes nobody can see costs
        // more than rebuilding the whole set from the live map once on resume.
        if (!this.running) {
          this.objectsStale = true;
          return;
        }
        let roads = false;
        for (const id of data.removed ?? []) roads = this.removeObjectInstance(id) || roads;
        for (const obj of data.added ?? []) roads = this.addObjectInstance(obj) || roads;
        // Deferred to the next rendered frame (flushObjectDirty): both rebuilds scan every object on
        // the map, and a dab's own remove+add churn (auto-trim especially) fires several of these
        // events — rebuilding inline here pays for that scan once per EVENT instead of once per FRAME.
        if (roads) this.roadTrimDirty = true;
        if (data.added?.length) this.iconRefineDirty = true;
        this.renderer.shadowMap.needsUpdate = true;
        this.chromeNudgeDirty = true;
        this.requestRender();
      };
      const onValidationFailed = (data: EditorEvents['validation-failed']) => {
        const terrainMode = data.cmd.type === CommandType.PaintTerrain || data.cmd.type === CommandType.EraseTerrain;
        this.overlay3d?.flashErrors(data.errors, terrainMode);
      };
      const onHistory = ({ cells, objects }: EditorEvents['history-applied']) => {
        const flash = resolveHistoryFlash(cells, objects);
        if (flash) this.overlay3d?.flashCommit(flash.cells);
      };
      bus.on('cells-changed', onCells);
      bus.on('objects-changed', onObjects);
      bus.on('validation-failed', onValidationFailed);
      bus.on('history-applied', onHistory);
      this.busDetach = () => {
        bus.off('cells-changed', onCells);
        bus.off('objects-changed', onObjects);
        bus.off('validation-failed', onValidationFailed);
        bus.off('history-applied', onHistory);
      };
    }
    this.buildObjects(this.liveState);
    this.buildPlaza(this.liveState);

    const off = mapCenterOffset(this.liveState.template.width, this.liveState.template.height);
    const bounds: MapBounds = { halfX: off.x, halfZ: off.z, maxY: layerToY(maxHeight(this.liveState)) };
    frameBounds(this.camera, this.controls, bounds);
    // Fog melts distant terrain into the horizon band (depth + immersion).
    this.scene.fog = new THREE.Fog(HORIZON, this.controls.maxDistance * 0.45, this.controls.maxDistance * 1.3);
    this.setupShadows(bounds);

    // Camera intro: capture the resting frame, then start FAR out (higher + pulled back, so the map
    // sits small in the fog) and fly in. Controls are paused until it lands.
    this.introTarget.copy(this.controls.target);
    this.introTo.copy(this.camera.position);
    const start = introStartOffset(
      this.introTo.x - this.introTarget.x,
      this.introTo.y - this.introTarget.y,
      this.introTo.z - this.introTarget.z,
    );
    this.introFrom.set(this.introTarget.x + start.x, this.introTarget.y + start.y, this.introTarget.z + start.z);
    // Reduced motion: no fly-in at all. The camera simply STAYS at the resting frame captured
    // above (introTo), controls stay live, and nothing glides.
    if (!isMotionReduced() && !this.lite) {
      this.camera.position.copy(this.introFrom);
      this.camera.lookAt(this.introTarget);
      this.controls.enabled = false;
      this.introActive = true;
      this.introStartMs = performance.now();
    }

    // The scene is STATIC after build (geometry + the directional sun + water never move; only the camera
    // orbits), so re-rendering the 2048² PCF soft shadow map every frame is pure waste. Compute it ONCE,
    // then freeze it — identical look, big per-frame FPS win.
    // autoUpdate first, so the priming render below cannot be the bake.
    this.renderer.shadowMap.autoUpdate = false;
    this.primeLightState();
    this.renderer.shadowMap.needsUpdate = true;

    // THE HOST'S BOX CHANGES WITHOUT THE WINDOW'S: the map is a layer of the interface, and the
    // assistant's docked panel takes a strip of the window out from under it. The window listener
    // stays for the one thing it alone reports, a page-zoom step, which redefines the css px the
    // box is measured in without necessarily changing the number.
    window.addEventListener('resize', this.onResize);
    if (typeof ResizeObserver === 'function') {
      this.boxWatch = new ResizeObserver(this.onResize);
      this.boxWatch.observe(this.container);
    }
    this.requestRender();
    this.loop();
  }

  private boxWatch: ResizeObserver | null = null;

  /** Open a short keep-alive render window (coalesced, spam-safe). */
  requestRender = (): void => { this.renderWindow = 4; };

  /** One-shot waiters for "a frame was actually DRAWN" (see onNextPaint). */
  private paintWaiters: Array<() => void> = [];

  /** Run `cb` after the next frame this scene DRAWS. The loop renders on demand, so the request
   *  also opens the render window — a waiter wants the current scene on screen, not the next edit's. */
  onNextPaint(cb: () => void): void {
    this.paintWaiters.push(cb);
    this.requestRender();
  }

  private notifyPainted(): void {
    if (this.paintWaiters.length === 0) return;
    const waiting = this.paintWaiters;
    this.paintWaiters = [];
    for (const cb of waiting) cb();
  }

  /** The scene → multisampled target → resolved fullscreen copy to the canvas.
   *  HalfFloat keeps the linear intermediate banding-free; the sRGB output
   *  transform still happens on the final canvas pass, so colours match a
   *  direct render exactly. */
  private setupMsaaTarget(w: number, h: number): void {
    // Rendering into a HalfFloat target needs EXT_color_buffer_float; where it's
    // missing, an 8-bit target still gives correct (slightly more banded) output.
    const half = this.renderer.extensions.has('EXT_color_buffer_float');
    const size = this.targetSize(w, h);
    this.msaaTarget = new THREE.WebGLRenderTarget(size.w, size.h, {
      samples: 4,
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const copyMat = new THREE.MeshBasicMaterial({ map: this.msaaTarget.texture, depthTest: false, depthWrite: false, toneMapped: false });
    this.copyScene = new THREE.Scene();
    this.copyScene.add(new THREE.Mesh(quadGeo, copyMat));
    this.disposables.push(quadGeo, copyMat, this.msaaTarget);
  }

  /** Render the scene once with the shadow pass switched off, so three has SET THE LIGHT STATE UP
   *  before the shadow map is ever baked.
   *
   *  `WebGLRenderer.render` runs `shadowMap.render` BEFORE `setupLights`, and a render state's light
   *  arrays start empty — so on a scene's FIRST render the shadow pass keys every depth program with
   *  zero lights, counts no later frame repeats (from the second render the state still holds the
   *  previous frame's setup). Those counts reach the program CACHE KEY but not the depth shader,
   *  whose source never mentions them: the programs are byte-identical and cached under keys nothing
   *  asks for again. The next bake therefore links the whole set a second time — and with the map
   *  frozen above, that bake is the user's FIRST EDIT. Measured on a software rasterizer: ~1.4s of
   *  driver link, in one block, the first time a brush touched the map.
   *
   *  Offscreen by construction: it draws into the target the next frame overwrites and skips the
   *  copy pass, so nothing reaches the canvas. Only the profile that HAS shadows pays for it (lite
   *  has neither shadows nor the MSAA target). */
  private primeLightState(): void {
    if (!this.renderer.shadowMap.enabled || !this.msaaTarget) return;
    this.renderer.shadowMap.needsUpdate = false;
    this.renderer.setRenderTarget(this.msaaTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  /** Draw one frame: scene into the MSAA target, then the resolved copy to the
   *  canvas. Every producer of a visible frame (loop, capture, intro skip) goes
   *  through here so on-screen and captured frames share one pipeline. */
  private renderFrame(): void {
    if (this.contextLost) return;
    this.flushTerrainDirty();
    this.flushObjectDirty();
    this.overlay3d?.flush();
    if (this.msaaTarget && this.copyScene) {
      this.renderer.setRenderTarget(this.msaaTarget);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.copyScene, this.copyCam);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.notifyPainted();
  }

  /** Render the current framing and return it as a PNG data URL. The synchronous
   *  render immediately before the read is what keeps the canvas readable
   *  (the drawing buffer is not preserved across frames — see the renderer
   *  options). Used by the in-view screenshot button. */
  capture(): string {
    this.renderFrame();
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** Capture the current framing CROPPED to a centred rect of `aspect` (width/
   *  height) — the largest that fits the canvas. The export re-renders each shot
   *  at CARD_3D_CELL_ASPECT with this same camera + vertical FOV, so that still is
   *  exactly this crop (full height, centre width for a wide view). Used by the
   *  edit-mode download so the PNG matches the viewfinder and the exported shot. */
  captureFramed(aspect: number): string {
    this.renderFrame();
    const src = this.renderer.domElement;
    const sw = src.width, sh = src.height;
    let cw = sw, ch = sh;
    if (sw / sh > aspect) cw = Math.max(1, Math.round(sh * aspect)); // wider than aspect → crop width
    else ch = Math.max(1, Math.round(sw / aspect));                  // taller → crop height
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    c.getContext('2d')!.drawImage(src, Math.round((sw - cw) / 2), Math.round((sh - ch) / 2), cw, ch, 0, 0, cw, ch);
    return c.toDataURL('image/png');
  }

  /** Capture from a specific orbit angle — used by the export path to produce several "smart angle"
   *  thumbnails from one scene. azimuth/elevation in degrees; distMul scales the resting distance
   *  (smaller = closer/detail). tx/tz shift the look-at target in world units (toward the map's
   *  elevation mass) so a closer detail shot frames the interesting region, not just the center. */
  captureFromAngle(azimuthDeg: number, elevationDeg: number, distMul = 1, tx = 0, tz = 0): string {
    this.applyCameraAngle({ az: azimuthDeg, el: elevationDeg, dist: distMul, tx, tz });
    return this.capture();
  }

  /** Pose the camera at a CameraAngle (getCurrentAngle's inverse) without capturing — the live
   *  editor's restore path (a saved 3D camera lands here instead of behind an image capture).
   *  Cancels the intro fly-in: landing where the user left off is the point of a restore, so
   *  flying somewhere else first would undo it (see captureFromAngle, which shares this math for
   *  the export-angle preview and always wants the intro out of the way too).
   *
   *  The distance is clamped into the controls' own dolly range: a save whose camera was read
   *  mid-intro (see reportedCameraAngle) holds a `dist` of ~2.4, past anything the controls allow,
   *  and restoring one verbatim lands the user out in the fog. */
  applyCameraAngle(angle: CameraAngle): void {
    this.introActive = false;
    const baseDist = this.introTo.distanceTo(this.introTarget);
    const tgt = this.introTarget.clone();
    tgt.x += angle.tx ?? 0; tgt.z += angle.tz ?? 0;
    const dist = clamp(baseDist * angle.dist, this.controls.minDistance, this.controls.maxDistance);
    const az = (angle.az * Math.PI) / 180, el = (angle.el * Math.PI) / 180;
    const cosEl = Math.cos(el);
    this.camera.position.set(tgt.x + dist * cosEl * Math.sin(az), tgt.y + dist * Math.sin(el), tgt.z + dist * cosEl * Math.cos(az));
    this.camera.lookAt(tgt);
    this.controls.target.copy(tgt);
    this.controls.update();
    this.requestRender();
  }

  /** The current camera framing as a CameraAngle — the inverse of captureFromAngle. Reads the live
   *  OrbitControls target + camera position, so the export 3D-shots editor can capture whatever the
   *  user orbited to ("Use this view"), and io/autosave persists what the user is looking at. While
   *  the intro fly-in is in flight it reports the RESTING frame instead (see reportedCameraAngle). */
  getCurrentAngle(): CameraAngle {
    return reportedCameraAngle(this.camera.position, this.controls.target, this.introTo, this.introTarget, this.introActive);
  }

  /**
   * End the fly-in NOW, at its resting frame. Safe to call when no intro is running.
   *
   * Called by the camera verbs as well as the export path: the intro holds the controls dark for
   * its whole duration, so a user who reaches for the camera during it would otherwise be ignored
   * until it finished. A hand on the camera IS the request to stop watching.
   */
  private landIntro(): void {
    if (!this.introActive) return;
    // Snap the camera directly to its resting position and target (computed in the
    // constructor: introTo = resting camera pos, introTarget = resting orbit target).
    this.camera.position.copy(this.introTo);
    this.camera.lookAt(this.introTarget);
    this.controls.target.copy(this.introTarget);
    // The controls resume ONLY where they own input: in editor mode the pointer machine drives the
    // camera and OrbitControls must stay dark, or LEFT-drag goes back to its rotate handler and
    // fights every brush stroke.
    this.controls.enabled = !this.editorInput;
    this.controls.update();
    this.introActive = false;
  }

  /** Skip the ~0.8s camera fly-in intro and render one frame at the resting position.
   *  Used by the offscreen export capture path so it gets a fully-framed still without
   *  waiting for the animation loop. Safe to call even when the intro is already done. */
  skipIntroAndRender(): void {
    this.landIntro();
    this.renderFrame();
  }

  private loop = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    // The lines below are read verbatim by src/__tests__/canvas3d/water-rest.test.ts (lines 30-40).
    // Do not reformat this section without updating that test's expectations.
    let move = this.tickInertia();
    if (this.introActive) { this.animateIntro(); move = true; }
    if (this.camTween) { this.animateCamTween(); move = true; }
    if (this.overlay3d?.tick()) move = true;
    if (this.tickPlops()) move = true;
    if (this.tickSpins()) move = true;
    if (this.tickGroupArc()) move = true;
    if (move) this.renderWindow = Math.max(this.renderWindow, 2);
    if (this.renderWindow <= 0) return;
    this.renderWindow--;
    // A camera glide decays exponentially, so it approaches rest without reaching it, and every one
    // of those frames re-antialiases all thin silhouettes (strobing borders on small models). Once
    // the detector sees visual rest, the controls' update is skipped so the pose truly freezes. The
    // detector is fed the pose EVERY frame and is purely observational: motion from any source (a
    // gesture, the glide, key pan, a view change — all of which write the camera directly)
    // unfreezes it by itself.
    if (!this.introActive && !this.camTween) {       // intro/tween drive the camera directly; controls resume after
      if (!this.cameraRest.isResting()) {
        if (this.controls.update()) this.renderWindow = Math.max(this.renderWindow, 2);
      }
      const restingNow = this.cameraRest.update(this.camera.position.toArray(), this.camera.quaternion.toArray(), this.controls.getDistance());
      if (!restingNow) this.bus?.emit('viewport-changed', { zoom: this.zoomPercent() / 100 });
    }
    this.renderFrame();
  };

  private addLights(): void {
    // Bright sky/ground fill keeps every face vivid (shadows stay soft, not muddy);
    // a warm directional adds low-poly definition + casts the contact shadows.
    const hemi = new THREE.HemisphereLight(0xffffff, 0xcdd8c0, 1.45);
    const sun = new THREE.DirectionalLight(0xfff6e6, 0.9);
    sun.position.set(6, 12, 8);
    this.sun = sun;
    this.scene.add(hemi, sun);
  }

  /** Configure the sun to cast soft shadows across the whole map (ortho frustum
   *  sized to the bounds). */
  private setupShadows(b: MapBounds): void {
    const sun = this.sun;
    sun.castShadow = true;
    const r = Math.max(b.halfX, b.halfZ) * 1.25 + 2;
    sun.position.set(r * 0.7, r * 1.6 + b.maxY, r * 0.55);
    sun.target.position.set(0, 0, 0);
    this.scene.add(sun.target);
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 0.5; cam.far = r * 4 + b.maxY * 2;
    cam.updateProjectionMatrix();
    // The shadow map spans the WHOLE map, so a small object gets few texels and its contact reads as
    // a vague, slightly-detached blob (the object looks to float). The map is FROZEN after the first
    // frame (autoUpdate off), so a bigger map is a one-time cost — use 4096² on capable devices for a
    // crisper contact; low-end stays 2048². normalBias pins the shadow to the object's base (kills the
    // peter-pan gap between object and shadow that reads as floating).
    const shadowRes = maxRenderScale() >= 2 ? 4096 : 2048;
    sun.shadow.mapSize.set(shadowRes, shadowRes);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
  }

  private buildTerrain(state: GridState): void {
    this.opaqueMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    this.wetMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    // The road decal composites over the terrain by per-vertex ALPHA (the feather fades to the
    // ground as it actually renders, and two fades crossing blend instead of z-fighting), so it is
    // transparent and never writes depth — it lies a hair above a surface the depth buffer already
    // holds. No grid injection: the draped grid lives in the terrain material, so it stops at a
    // road's own surface.
    this.roadTrimMat = new THREE.MeshLambertMaterial({
      vertexColors: true, flatShading: true, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    });
    this.disposables.push(this.opaqueMat, this.wetMat, this.roadTrimMat);
    // The reference grid + chunk bounds are DRAPED onto the terrain via the material shader (world XZ),
    // so they follow the surface as a light texture. Align to macro cells + seed the live toggles.
    const goff = mapCenterOffset(state.template.width, state.template.height);
    this.gridUniforms.uGridOff.value.set(goff.x, goff.z);
    this.gridUniforms.uGrid.value = this.passive.grid ? 1 : 0;
    this.gridUniforms.uChunks.value = this.passive.chunks ? 1 : 0;
    addGridOverlay(this.opaqueMat, this.gridUniforms);
    const wc = waterColor();
    const deep = new THREE.Color().setRGB(wc[0], wc[1], wc[2], THREE.SRGBColorSpace);
    const foam = new THREE.Color().setRGB(Math.min(1, wc[0] + 0.22), Math.min(1, wc[1] + 0.22), Math.min(1, wc[2] + 0.22), THREE.SRGBColorSpace);
    this.fallDeep = [deep.r, deep.g, deep.b];
    this.fallFoam = [foam.r, foam.g, foam.b];
    // Trimmed road tiles (edge-cut corners) — a flat custom mesh; untrimmed roads stay instanced.
    this.rebuildRoadTrim();
    const chunksX = Math.ceil(state.template.width / CHUNK_SIZE);
    const chunksY = Math.ceil(state.template.height / CHUNK_SIZE);
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) this.rebuildChunk(cx, cy);
    }
  }

  /** The state the terrain mesher consumes: the live state, or (with layers
   *  hidden) its cached visibility view — 2D peel semantics via clampNeighbor. */
  private meshState(): GridState {
    if (this.hiddenLayers.size === 0) return this.liveState;
    if (!this.viewCache) this.viewCache = visibilityView(this.liveState, this.hiddenLayers);
    return this.viewCache;
  }

  /** Apply a layer-visibility change: remesh the affected chunks under the new
   *  peel view, zero-scale instanced objects on hidden elevations (their slot
   *  keeps its metadata, so unhiding rewrites the real transform), filter the
   *  trimmed-road mesh, and hide the plaza with its layer. */
  setLayerVisibility(hidden: ReadonlySet<number>): void {
    const changed: number[] = [];
    for (const l of hidden) if (!this.hiddenLayers.has(l)) changed.push(l);
    for (const l of this.hiddenLayers) if (!hidden.has(l)) changed.push(l);
    if (changed.length === 0) return;
    this.hiddenLayers = new Set(hidden);
    this.viewCache = null;
    const { width, height } = this.liveState.template;
    for (const k of dirtyChunksFor(cellsAffectedByLayerToggle(this.liveState, changed), width, height)) {
      this.dirtyTerrain.add(k);
    }
    for (const [id, elev] of this.objElevation) {
      if (!changed.includes(elev)) continue;
      const ref = this.slots.slotOf(id);
      if (!ref) continue;
      const group = this.groups.get(ref.group);
      const inst = group?.instances[ref.slot];
      if (!group || !inst) continue;
      if (hidden.has(elev)) this.writeHiddenInstance(group, ref.slot);
      else this.writeInstance(group, ref.slot, inst);
    }
    this.rebuildRoadTrim();
    this.rebuildWaterfallArrows();
    if (this.plazaGroup && this.plazaElevation !== null) {
      this.plazaGroup.visible = !hidden.has(this.plazaElevation);
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  /** Placement plop: the 2D sprite squash on the fresh instance's matrix, with
   *  the SAME tuning (animConfig.plop): footprint-scaled amplitude, the settle
   *  duration, and a damped single-bounce ease. Runs off the instance's stored
   *  transform, so it composes with (and settles back to) the real placement. */
  private tickPlops(): boolean {
    if (this.plops.size === 0) return false;
    const now = performance.now();
    const cfg = animConfig.plop;
    for (const [id, born] of this.plops) {
      const t = (now - born) / cfg.settleMs;
      const ref = this.slots.slotOf(id);
      const group = ref ? this.groups.get(ref.group) : null;
      const inst = group?.instances[ref!.slot];
      if (!ref || !group || !inst || t >= 1) {
        if (ref && group && inst) this.writeInstance(group, ref.slot, inst);
        this.plops.delete(id);
        continue;
      }
      // Footprint scaling mirrors 2D: bigger objects squash less (~1/size).
      const span = Math.max(inst.scaleX, inst.scaleZ, 1);
      const ampX = 1 + (cfg.squashX - 1) / span;
      const ampY = 1 - (1 - cfg.squashY) / span;
      // Damped settle from squashed toward rest, one soft overshoot (cfg.bounce).
      const settle = 1 - (1 - t) * (1 - t) * Math.cos(t * Math.PI * cfg.bounce * 0.5);
      const sy = ampY + (1 - ampY) * settle;
      const sxz = ampX + (1 - ampX) * settle;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, inst.rotationY);
      m.compose(
        new THREE.Vector3(inst.x, inst.y, inst.z),
        q,
        new THREE.Vector3(inst.scaleX * sxz, inst.scaleY * sy, inst.scaleZ * sxz),
      );
      group.mesh.setMatrixAt(ref.slot, m);
      group.mesh.instanceMatrix.needsUpdate = true;
    }
    return this.plops.size > 0;
  }

  /** Rotation: an angular ease with a soft overshoot (animConfig.rotation) on
   *  the instance's matrix — the state already holds the FINAL angle, so the
   *  tween back-dates the visible rotation and settles onto the real one. */
  private tickSpins(): boolean {
    if (this.spins.size === 0) return false;
    const now = performance.now();
    const cfg = animConfig.rotation;
    for (const [id, spin] of this.spins) {
      const t = (now - spin.born) / cfg.durationMs;
      const ref = this.slots.slotOf(id);
      const group = ref ? this.groups.get(ref.group) : null;
      const inst = group?.instances[ref!.slot];
      if (!ref || !group || !inst || t >= 1) {
        if (ref && group && inst) this.writeInstance(group, ref.slot, inst);
        spin.onFrame?.(1);
        this.spins.delete(id);
        continue;
      }
      // Overshoot ease: swing past the target by cfg.overshoot degrees, settle.
      const ease = 1 - (1 - t) * (1 - t);
      const swing = Math.sin(t * Math.PI) * cfg.overshoot;
      const deg = spin.from + (spin.to - spin.from) * ease + swing;
      const m = new THREE.Matrix4();
      // Yaw = ROT(deg) = restYaw + (to − deg)·π/180 (ROT's slope is −π/180). At
      // deg=from this is exactly the PREVIOUS rotation's yaw (correct first frame);
      // as deg climbs to `to` the yaw decreases to restYaw — a CW turn from above,
      // matching the 2D sprite.
      const q = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, inst.rotationY + ((spin.to - deg) * Math.PI) / 180);
      m.compose(new THREE.Vector3(inst.x, inst.y, inst.z), q, new THREE.Vector3(inst.scaleX, inst.scaleY, inst.scaleZ));
      group.mesh.setMatrixAt(ref.slot, m);
      group.mesh.instanceMatrix.needsUpdate = true;
      spin.onFrame?.(ease);
    }
    // The shadow map is frozen (autoUpdate off), so a spinning object's shadow would otherwise stay
    // fixed while the object turns. Re-cast it each frame a spin is active — including the frame the
    // last spin settles (writeInstance above set the final matrix) — so the shadow tracks and lands
    // at the final orientation.
    this.renderer.shadowMap.needsUpdate = true;
    return this.spins.size > 0;
  }

  /**
   * Group rotation: the selection turns as ONE rigid body. Every member travels an ARC about the
   * shared centre and a SPUN member also yaws by the same quarter turn; a CARRIED member travels
   * without yawing. One entry, one clock: the members must share a start, a duration and an easing
   * or the body comes apart (see canvas/group-arc.ts), which is also why a second turn replaces
   * this one rather than queueing beside it.
   *
   * Cell units ARE world units on the ground plane, so the arc's cell-space offset applies straight
   * to a member's stored x/z — no re-projection, and the same numbers the 2D tween uses.
   *
   * A TRIM-MESHED ROAD has no instance matrix to write, so its share of the turn is applied by
   * rebuilding the trimmed-road mesh with the frame's offsets. That rebuild is skipped entirely
   * unless the selection actually holds one.
   */
  private tickGroupArc(): boolean {
    const arc = this.groupArc;
    if (!arc) return false;
    const cfg = animConfig.groupRotation;
    const t = Math.min((performance.now() - arc.born) / cfg.durationMs, 1);
    const e = t < 1 ? easeOutBack(t, cfg.overshoot) : 1;
    const roadOffsets = arc.hasRoadTrim ? new Map<string, { dx: number; dz: number }>() : null;
    for (const m of arc.members) {
      if (m.roadTrim) {
        if (roadOffsets && t < 1) {
          const { dx, dy } = arcOffset(m.motion, arc.sweepRad, e);
          roadOffsets.set(m.id, { dx, dz: dy });
        }
        continue;
      }
      const ref = this.slots.slotOf(m.id);
      const group = ref ? this.groups.get(ref.group) : null;
      const inst = ref && group ? group.instances[ref.slot] : null;
      if (!ref || !group || !inst) continue;
      if (t >= 1) { this.writeInstance(group, ref.slot, inst); continue; }
      const { dx, dy } = arcOffset(m.motion, arc.sweepRad, e);
      // Yaw runs OPPOSITE the screen-space spin offset (ROT's slope is −π/180, as in tickSpins), so
      // a member back-dated by a clockwise-from-above turn settles onto its stored rotation.
      const yaw = inst.rotationY - (m.spun ? spinOffset(arc.sweepRad, e) : 0);
      const mat = new THREE.Matrix4().compose(
        new THREE.Vector3(inst.x + dx, inst.y, inst.z + dy),
        new THREE.Quaternion().setFromAxisAngle(UP_AXIS, yaw),
        new THREE.Vector3(inst.scaleX, inst.scaleY, inst.scaleZ),
      );
      group.mesh.setMatrixAt(ref.slot, mat);
      group.mesh.instanceMatrix.needsUpdate = true;
    }
    if (roadOffsets) this.rebuildRoadTrim(roadOffsets.size > 0 ? roadOffsets : undefined);
    // The shadow map is frozen, so every moving member's shadow would otherwise stay behind on the
    // ground — including on the settling frame, where writeInstance above landed the real transform.
    this.renderer.shadowMap.needsUpdate = true;
    arc.onFrame?.(e);
    if (t >= 1) this.groupArc = null;
    return this.groupArc !== null;
  }

  /** A zero-scale matrix hides one instance without disturbing its slot. */
  private writeHiddenInstance(group: InstanceGroup, slot: number): void {
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    group.mesh.setMatrixAt(slot, m);
    group.mesh.instanceMatrix.needsUpdate = true;
  }

  /** (Re)mesh one terrain chunk from the live state, replacing its previous
   *  meshes. Chunks are independent scene objects, so an edit costs only its
   *  dirty ring, and three's per-mesh frustum culling applies chunk-wise. */
  private rebuildChunk(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const prev = this.terrainChunks.get(key);
    if (prev) {
      for (const mesh of prev.meshes) this.scene.remove(mesh);
      if (prev.numbers) {
        this.scene.remove(prev.numbers.mesh);
        (prev.numbers.mesh.material as THREE.Material).dispose();
        prev.numbers.tex.dispose();
      }
      for (const geo of prev.geometries) geo.dispose();
      this.terrainChunks.delete(key);
    }
    const { solid, ground, water, fall } = buildChunkTerrain(this.meshState(), cx, cy);
    const entry: TerrainChunk = { meshes: [], geometries: [], numbers: null };
    const addOpaque = (data: MeshData) => {
      if (!data.positions.length) return;
      const geo = toGeometry(data);
      const mesh = new THREE.Mesh(geo, this.opaqueMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      entry.meshes.push(mesh);
      entry.geometries.push(geo);
    };
    addOpaque(solid);
    addOpaque(ground);
    if (water.positions.length) {
      // Translucent water: no shadow cast/receive (avoids transparency artifacts).
      const geo = toGeometry(water);
      const mesh = new THREE.Mesh(geo, this.wetMat);
      this.scene.add(mesh);
      entry.meshes.push(mesh);
      entry.geometries.push(geo);
    }
    if (fall.positions.length) {
      // Waterfall / pond-cliff faces: the cascade shading, painted into the colour buffer once.
      const geo = toGeometry(fall);
      this.shadeFall(geo);
      const mesh = new THREE.Mesh(geo, this.wetMat);
      this.scene.add(mesh);
      entry.meshes.push(mesh);
      entry.geometries.push(geo);
    }
    this.attachPassive(entry, cx, cy);
    if (entry.meshes.length || entry.numbers) this.terrainChunks.set(key, entry);
  }

  /** Per-chunk passive overlays (grid lines, layer-number quads) rebuilt with
   *  their chunk so they always drape the CURRENT surface. Built only while
   *  their settings toggle is on — a toggle marks every chunk dirty. */
  private attachPassive(entry: TerrainChunk, cx: number, cy: number): void {
    if (this.passive.numbers) {
      const quads = chunkNumberQuads(this.meshState(), cx, cy, this.hiddenLayers);
      if (quads.positions.length) {
        const canvas = this.paintNumberAtlas(cx, cy);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(quads.positions, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(quads.uvs, 2));
        geo.setIndex(quads.index);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        addLabelFade(mat); // smooth density LOD, the same window the draped grid fades on
        const mesh = new THREE.Mesh(geo, mat);
        this.scene.add(mesh);
        entry.numbers = { mesh, tex };
        entry.geometries.push(geo);
      }
    }
  }

  /** The chunk's label atlas: each cell's elevation drawn into its own slot,
   *  mirroring the 2D number raster's look (bold white on a dark outline). */
  private paintNumberAtlas(cx: number, cy: number): HTMLCanvasElement {
    // One 64px slot per cell — the label repeats the 2D raster exactly: bold
    // 14px monospace, bottom-left corner, white over a black outline.
    const SLOT = 64;
    const canvas = document.createElement('canvas');
    canvas.width = CHUNK_SIZE * SLOT;
    canvas.height = CHUNK_SIZE * SLOT;
    const ctx2d = canvas.getContext('2d')!;
    setNumberLabelStyle(ctx2d);
    for (const { x, y, label } of chunkNumberCells(this.meshState(), cx, cy, this.hiddenLayers)) {
      const px = (x - cx * CHUNK_SIZE) * SLOT + 3;
      const py = (y - cy * CHUNK_SIZE) * SLOT + SLOT - 3;
      drawNumberLabel(ctx2d, label, px, py);
    }
    return canvas;
  }

  /** Settings toggles for the passive overlays. The grid + chunk bounds are DRAPED via the terrain
   *  shader (see addGridOverlay) — toggling is a single uniform write, no rebuild; only the layer
   *  numbers remesh with their chunks. */
  /** The plan-notes layer as the store holds it; the scene re-drapes the same ask itself when the
   *  ground moves. */
  setAnnotations(data: AnnotationsState | null, opts: Annotations3DOpts): void {
    this.annotations3d.update(this.meshState(), data, opts);
    this.requestRender();
  }

  /** Re-rasterise the note labels — for when the app's own fonts finish loading after the first
   *  bake, which would otherwise leave fallback-face lettering standing for the session. */
  rebakeAnnotationText(): void {
    this.annotations3d.dropBakes();
    this.annotations3d.refresh(this.meshState());
    this.requestRender();
  }

  setPassiveOverlays(flags: { grid: boolean; numbers: boolean; chunks: boolean }): void {
    const rebuild = flags.numbers !== this.passive.numbers;
    this.passive = { ...flags };
    if (rebuild) this.dirtyAllChunks();
    this.gridUniforms.uGrid.value = flags.grid ? 1 : 0;
    this.gridUniforms.uChunks.value = flags.chunks ? 1 : 0;
    this.rebuildLegend();
    this.requestRender();
  }

  /** The chunk coordinate legend (row letters A,B,C… on the LEFT, column numbers 1,2,3… on the BOTTOM),
   *  laid FLAT on the ground just outside the map edge — the 3D echo of the 2D legend. Shown with the
   *  chunk bounds (it labels that same chunk grid). Toggling rebuilds it; disposed on the next toggle. */
  private rebuildLegend(): void {
    if (this.legendGroup) {
      this.scene.remove(this.legendGroup);
      // Each label owns a unique ShapeGeometry; the material is shared + persistent (disposed with
      // the scene), so only the geometries are freed here.
      this.legendGroup.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.legendGroup = null;
    }
    if (!this.passive.chunks) return;
    if (!this.legendMat) {
      // Black bold sans-serif like the 2D legend, but a heavier alpha: the 2D map's 0.12 reads over a
      // light map background, whereas the 3D ground beside the map is darker, so the same alpha washes
      // out — 0.45 carries the equivalent visual weight. depthTest stays ON (the default) so terrain
      // between the camera and a label OCCLUDES it instead of the label punching through onto the
      // top layer.
      this.legendMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
      this.disposables.push(this.legendMat);
    }
    const { width, height } = this.liveState.template;
    const off = mapCenterOffset(width, height);
    const chunksX = Math.ceil(width / CHUNK_SIZE);
    const chunksY = Math.ceil(height / CHUNK_SIZE);
    const LS = Math.min(CHUNK_SIZE * 0.7, 9); // label size (world units)
    const GAP = LS * 0.75;                    // distance from the map edge to the label centre
    const group = new THREE.Group();
    const addLabel = (text: string, wx: number, wz: number): void => {
      const mesh = new THREE.Mesh(labelGeometry(text, LS * 0.45), this.legendMat!);
      mesh.rotation.x = -Math.PI / 2; // lie flat on the ground (XZ), reading from above
      mesh.position.set(wx, 0.12, wz);
      group.add(mesh);
    };
    // Centre each label on a FULL CHUNK_SIZE stride (like the 2D legend), so a partial last chunk
    // doesn't pull its label toward the previous one — keeps the gaps uniform (e.g. 10 → 11).
    for (let r = 0; r < chunksY; r++) {
      addLabel(String.fromCharCode(65 + (r % 26)), -off.x - GAP, r * CHUNK_SIZE + CHUNK_SIZE / 2 - off.z);
    }
    for (let c = 0; c < chunksX; c++) {
      addLabel(String(c + 1), c * CHUNK_SIZE + CHUNK_SIZE / 2 - off.x, height - off.z + GAP);
    }
    this.scene.add(group);
    this.legendGroup = group;
  }

  private dirtyAllChunks(): void {
    const { width, height } = this.liveState.template;
    for (let cy = 0; cy * CHUNK_SIZE < height; cy++) {
      for (let cx = 0; cx * CHUNK_SIZE < width; cx++) this.dirtyTerrain.add(`${cx},${cy}`);
    }
  }

  /** Remesh every chunk an edit dirtied — called once per rendered frame, so a
   *  multi-command stroke coalesces. Refreshes the frozen shadow map once. */
  private flushTerrainDirty(): void {
    if (this.dirtyTerrain.size === 0) return;
    for (const key of this.dirtyTerrain) {
      const [cx, cy] = key.split(',').map(Number);
      this.rebuildChunk(cx!, cy!);
    }
    this.dirtyTerrain.clear();
    this.rebuildWaterfallArrows();
    // Re-baked HERE, with the terrain flush, so the drape and the ground under it are one frame's
    // worth of the same map. Coalesced with it too: a generation fires thousands of cells-changed.
    if (this.buildableDirty) { this.buildableDirty = false; this.overlay3d?.refreshBuildable(); }
    this.annotations3d.refresh(this.meshState());
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Whether the buildable drape needs re-baking against the terrain as it now stands. */
  private buildableDirty = false;

  /** Runs the road-trim/icon-colour rebuilds onObjects flagged as dirty, and nudges the chrome —
   *  once per rendered frame, so however many objects-changed events one dab's remove+add churn
   *  fires, each whole-map scan (buildRoadTrimMeshes over every object, refineIconColors over every
   *  instance) and each chrome repaint runs only once. */
  private flushObjectDirty(): void {
    if (this.roadTrimDirty) { this.roadTrimDirty = false; this.rebuildRoadTrim(); }
    if (this.iconRefineDirty) { this.iconRefineDirty = false; this.refineIconColors(); }
    if (this.chromeNudgeDirty) {
      this.chromeNudgeDirty = false;
      this.bus?.emit('viewport-changed', { zoom: this.zoomPercent() / 100 });
    }
  }

  /** White flow arrows at waterfall faces — the 3D twin of the 2D indicator
   *  pass, riding each face's water surface. Rebuilt whole after any terrain
   *  flush (the detection is a fast full-grid scan, and flushes are per-frame
   *  coalesced). */
  private rebuildWaterfallArrows(): void {
    this.arrowGroup.clear();
    for (const d of this.arrowDisposables) d.dispose();
    this.arrowDisposables = [];
    const state = this.meshState();
    const { width, height } = state.template;
    const off = mapCenterOffset(width, height);
    const cellFaces = waterfallFaceMap(state);
    if (cellFaces.size === 0) { this.requestRender(); return; }
    const positions: number[] = [];
    const half = 0.16;
    for (const [key, dirs] of cellFaces) {
      const [x, y] = key.split(',').map(Number);
      const t = getCell(state.cells, x!, y!)?.terrain;
      if (!t || this.hiddenLayers.has(t.elevation)) continue;
      // Terrain grid (−0.5): the arrow floats over the water cell's surface.
      const wx = x! - off.x, wz = y! - off.z;
      const h = surfaceHeightAt(state, wx, wz) + 0.05;
      const spread = dirs.length > 1 ? 0.22 : 0;
      for (const dir of dirs) {
        let cxp = wx, czp = wz;
        if (dir === 'north') czp -= spread;
        else if (dir === 'south') czp += spread;
        else if (dir === 'west') cxp -= spread;
        else if (dir === 'east') cxp += spread;
        const tri: Record<string, number[]> = {
          north: [cxp, czp - half, cxp - half, czp + half, cxp + half, czp + half],
          south: [cxp, czp + half, cxp - half, czp - half, cxp + half, czp - half],
          west: [cxp - half, czp, cxp + half, czp - half, cxp + half, czp + half],
          east: [cxp + half, czp, cxp - half, czp - half, cxp - half, czp + half],
        };
        const [ax, az, bx, bz, cx2, cz2] = tri[dir]!;
        positions.push(ax!, h, az!, bx!, h, bz!, cx2!, h, cz2!);
      }
    }
    if (positions.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
      this.arrowGroup.add(new THREE.Mesh(geo, mat));
      this.arrowDisposables.push(geo, mat);
    }
    this.requestRender();
  }

  private arrowDisposables: { dispose(): void }[] = [];

  /** The cascade shading, three layers deep so a fall reads as WATER rather than one flat blue
   *  face: broad SHEETS set the large-scale flow, fine STREAKS ride on top (both squared/cubed so
   *  the base stays deep, never a white flash), and a SPLASH band brightens the bottom of the drop
   *  where the water lands. Painted into the fall mesh's colour buffer as it is built, which is why
   *  `FALL_SEGMENTS` subdivides the face: the pattern varies down the drop.
   *
   *  `FALL_PHASE` shifts the pattern along the face. Any value draws the same kind of cascade — the
   *  shading is a function of the vertex's own position, so the phase moves the streaks rather than
   *  changing what they are. */
  private shadeFall(geo: THREE.BufferGeometry): void {
    const [dr, dg, db] = this.fallDeep;
    const [fr, fg, fb] = this.fallFoam;
    const t1 = FALL_PHASE * 0.18; // sheets
    const t2 = FALL_PHASE * 0.34; // streaks + splash
    const pos = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
    const arr = colAttr.array as Float32Array;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const px = pos[i * 3]!, py = pos[i * 3 + 1]!;
      const s1 = Math.sin(py * 5.5 + px * 3.1 + t1);
      const sheet = s1 > 0 ? s1 * s1 : 0;
      const s2 = Math.sin(py * 13 + px * 8.7 + t2 + 1.7);
      const streak = s2 > 0 ? s2 * s2 * s2 : 0;
      const base = Math.max(0, 1 - py / 0.35);
      const splash = base * base * (0.5 + 0.2 * Math.sin(px * 7 + t2 * 1.3));
      let k = 0.1 + 0.26 * sheet + 0.22 * streak + 0.5 * splash;
      if (k > 1) k = 1;
      arr[i * 3] = dr + (fr - dr) * k;
      arr[i * 3 + 1] = dg + (fg - dg) * k;
      arr[i * 3 + 2] = db + (fb - db) * k;
    }
    colAttr.needsUpdate = true;
  }

  private buildObjects(state: GridState): void {
    for (const obj of state.objects.values()) this.addObjectInstance(obj);
    this.refineIconColors();
  }

  /** Instance one object into its group (creating/growing the group's mesh as
   *  needed). Returns true when the object is a road — the caller decides
   *  whether the trimmed-road mesh needs a rebuild. */
  private addObjectInstance(obj: PlacedObject): boolean {
    const isRoad = getCatalogItem(obj.catalogId)?.category === ItemCategory.Road;
    if (isRoad) this.roadIds.add(obj.id);
    const resolved = objectInstance(this.liveState, obj);
    if (!resolved) return isRoad; // trimmed road: meshed by the road-trim pass
    const group = this.ensureGroup(resolved.groupKey);
    if (!group) return isRoad;
    const slot = this.slots.add(obj.id, resolved.groupKey);
    if (slot >= group.capacity) this.growGroup(resolved.groupKey, group);
    group.instances[slot] = resolved.inst;
    this.objElevation.set(obj.id, obj.elevation);
    if (this.hiddenLayers.has(obj.elevation)) this.writeHiddenInstance(group, slot);
    else this.writeInstance(group, slot, resolved.inst);
    group.mesh.count = this.slots.count(resolved.groupKey);
    return isRoad;
  }

  /** Free one object's instance slot, keeping the group dense (the group's
   *  last instance moves into the hole). Returns true for roads. */
  private removeObjectInstance(id: string): boolean {
    const isRoad = this.roadIds.delete(id);
    this.objElevation.delete(id);
    const removed = this.slots.remove(id);
    if (!removed) return isRoad; // not instanced (trimmed road, or unknown)
    const group = this.groups.get(removed.group);
    if (!group) return isRoad;
    if (removed.moved) {
      const inst = group.instances[removed.moved.fromSlot]!;
      group.instances[removed.slot] = inst;
      group.instances[removed.moved.fromSlot] = null;
      this.writeInstance(group, removed.slot, inst);
    } else {
      group.instances[removed.slot] = null;
    }
    group.mesh.count = this.slots.count(removed.group);
    group.mesh.instanceMatrix.needsUpdate = true;
    return isRoad;
  }

  private ensureGroup(key: string): InstanceGroup | null {
    const existing = this.groups.get(key);
    if (existing) return existing;
    // 'm:<id>' → bespoke per-item model (baked vertex colours, no instance tint);
    // 'a:<archetype>' → category archetype (white material + per-instance tint).
    const isModel = key.startsWith('m:');
    const geo = isModel ? modelGeometry(key.slice(2)) : archetypeGeometry(key.slice(2) as ArchetypeKey);
    if (!geo) return null;                           // shared/cached → freed by disposeModels/disposeArchetypes
    ensureFadeRadius(geo);                           // bake aObjR once so the proximity fade keys off the object's skin

    const group: InstanceGroup = { mesh: this.makeInstancedMesh(key, geo, 16), capacity: 16, isModel, geo, instances: [] };
    this.groups.set(key, group);
    return group;
  }

  private makeInstancedMesh(key: string, geo: THREE.BufferGeometry, capacity: number): THREE.InstancedMesh {
    const isModel = key.startsWith('m:');
    // Flat ground decals (road tiles, the plaza platform) skip the proximity fade — the floor
    // under a low camera must not dissolve; everything else fades when the camera pushes into it.
    const isDecal = key === `a:${ItemCategory.Road}` || key === 'a:platform';
    const mesh = new THREE.InstancedMesh(geo, isModel ? this.modelMat : isDecal ? this.decalMat : this.sharedMat, capacity);
    mesh.count = 0;
    // Instances sit far from the origin but the geometry's bounding sphere is
    // origin-centred; skip frustum culling (≤ a handful of meshes) so whole
    // groups never pop out when the origin leaves the frustum.
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.instanced.push(mesh);
    return mesh;
  }

  /** Double a full group's capacity, copying the live instance buffers. */
  private growGroup(key: string, group: InstanceGroup): void {
    const old = group.mesh;
    const next = this.makeInstancedMesh(key, group.geo, group.capacity * 2);
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    next.instanceMatrix.needsUpdate = true;
    if (old.instanceColor) {
      // Materialize the color buffer at the new capacity before copying.
      next.setColorAt(0, new THREE.Color());
      (next.instanceColor!.array as Float32Array).set(old.instanceColor.array as Float32Array);
      next.instanceColor!.needsUpdate = true;
    }
    next.count = old.count;
    this.scene.remove(old);
    old.dispose();
    this.instanced = this.instanced.filter((m2) => m2 !== old);
    group.mesh = next;
    group.capacity *= 2;
  }

  private writeInstance(group: InstanceGroup, slot: number, inst: ObjectInstance): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, inst.rotationY);
    m.compose(new THREE.Vector3(inst.x, inst.y, inst.z), q, new THREE.Vector3(inst.scaleX, inst.scaleY, inst.scaleZ));
    group.mesh.setMatrixAt(slot, m);
    group.mesh.instanceMatrix.needsUpdate = true;
    if (!group.isModel) {
      group.mesh.setColorAt(slot, new THREE.Color().setRGB(inst.color[0], inst.color[1], inst.color[2], THREE.SRGBColorSpace));
      group.mesh.instanceColor!.needsUpdate = true;
    }
  }

  /** The trimmed-road custom mesh, rebuilt whole when any road changes (the
   *  trimmed set is small — a rebuild costs far less than tracking per-chunk).
   *  `offsets` displaces named roads on the ground plane: the group-rotation tween's
   *  per-frame arc for a road that has no instance matrix to back-date. */
  private rebuildRoadTrim(offsets?: ReadonlyMap<string, { dx: number; dz: number }>): void {
    for (const mesh of this.roadTrimMeshes) this.scene.remove(mesh);
    for (const geo of this.roadTrimGeos) geo.dispose(); // the materials are cached per material, not per rebuild
    this.roadTrimMeshes = [];
    this.roadTrimGeos = [];
    for (const part of buildRoadTrimMeshes(this.liveState, this.hiddenLayers, offsets)) {
      const geo = toGeometry(part.mesh);
      const mesh = new THREE.Mesh(geo, this.roadMaterial(part));
      // A flat decal on the surface casts no shadow of its own — and the shadow depth pass ignores
      // vertex alpha, so letting it cast would print the feather's full square silhouette.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.roadTrimMeshes.push(mesh);
      this.roadTrimGeos.push(geo);
    }
  }

  /**
   * The material one road material's surfaces draw with: its tile art repeat-wrapped across the
   * decal's grid UVs, or — until that art has decoded, and for a road that has no art at all — the
   * plain vertex-coloured decal material. The stand-in for a TEXTURED material is a tinted clone,
   * since the builder leaves those vertices white for the art to colour.
   */
  private roadMaterial(part: RoadTrimPart): THREE.MeshLambertMaterial {
    if (!part.icon) return this.roadTrimMat;
    const url = iconUrl(part.icon);
    const canvas = url ? roadTileCanvas(url, this.onRoadArtLoaded) : undefined;
    const key = `${part.material}:${canvas ? 'tex' : 'flat'}`;
    const hit = this.roadTileMats.get(key);
    if (hit) return hit;
    const mat = this.roadTrimMat.clone();
    if (canvas) {
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; // the crop is power-of-two, so REPEAT is legal on WebGL1 too
      // A road decal's v IS its world Z (build/terrain-geometry:fillGridUvs), so v grows SOUTH,
      // the direction a canvas row index grows. three.js uploads a CanvasTexture flipped by
      // default, which would sample the tile bottom-up and hand the 3D view a vertically mirrored
      // pattern — visible on any asymmetric path (a herringbone's chevrons point the other way).
      // The label atlas solves the same thing on the UV side (build/passive-geometry emits 1 - v);
      // here the texture is ours alone, so it is one property rather than a term in the geometry.
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      // A ground plane is seen at glancing angles almost everywhere; without this the tiling
      // pattern aliases into a shimmer well before the horizon.
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      mat.map = tex;
      this.disposables.push(tex);
    } else {
      const hex = getCatalogItem(part.material)?.color;
      if (hex) mat.color.setStyle(hex, THREE.SRGBColorSpace);
    }
    this.disposables.push(mat);
    this.roadTileMats.set(key, mat);
    return mat;
  }

  /** A path's tile art has decoded: the surfaces already standing were built with the stand-in
   *  material, and only a rebuild swaps them onto the textured one. Marks the same dirty flag an
   *  edit does, so however many materials land together they cost one rebuild. */
  private onRoadArtLoaded = (): void => {
    if (this.disposed) return; // the view was torn down while its art was still loading
    this.roadTrimDirty = true;
    this.requestRender();
  };

  /** A small LOW-POLY model for the central plaza (it would otherwise be a blank platform): a raised
   *  wood courtyard inset on the stone platform, with an octagonal pavilion umbrella + a green awning
   *  and a bench — echoing the 2D plaza art. Sized to the plaza footprint; the fixed accents scale to
   *  the smaller side so they read at any plaza size. Built statically (the camera intro flies in). */
  private buildPlaza(state: GridState): void {
    let plaza: PlacedObject | undefined;
    for (const o of state.objects.values()) if (o.width !== undefined && o.height !== undefined) { plaza = o; break; }
    if (!plaza) return;
    const { width, height } = state.template;
    const size = getPlacedObjectSize(plaza);
    const corner = cellCornerWorld(plaza.position.x, plaza.position.y, width, height);
    const cx = corner.x + size.w / 2, cz = corner.z + size.h / 2;
    const W = size.w, H = size.h, s = Math.min(W, H); // s = accent scale
    const PLAT = platformTopY(plaza.elevation); // deck top of the plinth the accents stand on
    const plazaGroup = new THREE.Group();
    this.scene.add(plazaGroup);
    this.plazaGroup = plazaGroup;
    this.plazaElevation = plaza.elevation;
    const part = (geo: THREE.BufferGeometry, hex: string, x: number, y: number, z: number): void => {
      const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color().setStyle(hex, THREE.SRGBColorSpace), flatShading: true });
      addProximityFade(mat); // plaza accents fade like any other object when the camera dives in
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      plazaGroup.add(mesh);
      this.disposables.push(geo, mat);
    };
    // raised wood courtyard, inset so the grey platform reads as a stone rim around it
    part(new THREE.BoxGeometry(W * 0.66, 0.12, H * 0.78), '#d9b98a', cx, PLAT + 0.06, cz);
    // octagonal pavilion umbrella near a corner of the courtyard (post + 8-gon canopy)
    const ux = cx - W * 0.22, uz = cz - H * 0.30, top = PLAT + 0.12;
    part(new THREE.CylinderGeometry(s * 0.02, s * 0.02, 0.5, 6), '#9c7b53', ux, top + 0.25, uz);
    part(new THREE.ConeGeometry(s * 0.14, 0.3, 8), '#ece0c4', ux, top + 0.6, uz);
    // a green awning/tent block + a bench, matching the icon's accents
    part(new THREE.BoxGeometry(W * 0.26, 0.34, H * 0.16), '#8cbf6e', cx + W * 0.12, top + 0.17, cz - H * 0.34);
    part(new THREE.BoxGeometry(s * 0.34, 0.16, s * 0.14), '#b98f5e', cx - W * 0.22, top + 0.08, cz + H * 0.30);
  }

  /** Glide the camera from the far framing to its resting frame (whole-map fly-in). Time-based, so
   *  it takes the same wall time at any refresh rate. */
  private animateIntro(): void {
    const t = (performance.now() - this.introStartMs) / animConfig.intro3d.durationMs;
    if (t >= 1) {
      this.camera.position.copy(this.introTo);
      this.camera.lookAt(this.introTarget);
      this.controls.enabled = !this.editorInput;
      this.controls.update();
      this.introActive = false;
      return;
    }
    this.camera.position.lerpVectors(this.introFrom, this.introTo, easeOutCubic(t));
    this.camera.lookAt(this.introTarget);
  }

  /** Refine each icon-sprite instance's tint from the category fallback to its
   *  icon's real dominant colour (async; per unique icon, once loaded). Degrades
   *  gracefully — if an icon never loads, the category colour stays. */
  private refineIconColors(): void {
    const urls = new Set<string>();
    for (const g of this.groups.values()) {
      if (g.isModel) continue; // models bake their colours
      for (const inst of g.instances) {
        if (inst?.icon) { const u = iconUrl(inst.icon); if (u) urls.add(u); }
      }
    }
    const col = new THREE.Color();
    for (const url of urls) {
      void iconDominantColor(url).then((rgb) => {
        if (!rgb || !this.running) return;
        let changed = false;
        for (const g of this.groups.values()) {
          if (g.isModel) continue;
          let touched = false;
          g.instances.forEach((inst, i) => {
            if (inst?.icon && iconUrl(inst.icon) === url) {
              g.mesh.setColorAt(i, col.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace));
              touched = true;
            }
          });
          if (touched && g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
          if (touched) changed = true;
        }
        if (changed) this.requestRender();
      });
    }
  }

  /** The multisampled target's pixel size for a CSS size, clamped to what the GL
   *  context can actually allocate. A renderbuffer past MAX_RENDERBUFFER_SIZE
   *  leaves the framebuffer INCOMPLETE and every frame resolves to nothing — a
   *  black view. Reachable by zooming the page out: that inflates the CSS
   *  viewport (a 33% zoom makes it 3x wider) while the pixel ratio caps the
   *  buffer, so the clamp is the backstop for whatever the ratio does not catch. */
  private targetSize(w: number, h: number): { w: number; h: number } {
    const pr = this.renderer.getPixelRatio();
    const gl = this.renderer.getContext();
    const limit = Math.min(
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    ) || 4096;
    const k = Math.min(1, limit / Math.max(1, Math.max(w, h) * pr));
    return {
      w: Math.max(1, Math.round(w * pr * k)),
      h: Math.max(1, Math.round(h * pr * k)),
    };
  }

  /**
   * The canvas following its own box, which the interface moves without the window changing
   * (the assistant's dock taking a strip of it).
   *
   * IT DRAWS THE FRAME IT RESIZES INTO, IN THE SAME TASK, and that is the whole reason this does not
   * simply ask for a render. Resizing a WebGL canvas reallocates the drawing buffer and the new one
   * starts EMPTY; this renderer keeps no preserved buffer and draws on demand, so a render merely
   * requested happens on the next frame and the compositor puts the empty one on screen first — one
   * transparent flash, at the moment the dock's slide settles and swaps the plane's transform for its
   * inset. A ResizeObserver callback runs before that frame is composited, so a synchronous draw here
   * means the resized buffer has the scene in it the first time anyone sees it.
   *
   * The render window is opened as well, since a box change often comes with a camera the controls
   * are still settling.
   */
  private onResize = (): void => {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Re-read the pixel ratio: it is devicePixelRatio-derived, and page zoom
    // moves devicePixelRatio while inflating the CSS viewport. Leaving it at the
    // boot value multiplies the two effects instead of cancelling them, so a
    // zoomed-out page asks for a buffer several times the screen's pixel count.
    this.renderer.setPixelRatio(maxRenderScale());
    this.renderer.setSize(w, h);
    const size = this.targetSize(w, h);
    this.msaaTarget?.setSize(size.w, size.h);
    this.requestRender();
    this.renderFrame();
  };

  /** World-space bounding box of one placed object's live mesh (instance
   *  geometry bounds under its instance transform), or null when it has no
   *  instanced representation (trimmed roads, the plaza's platform). */
  objectBoundingBox(id: string): THREE.Box3 | null {
    const ref = this.slots.slotOf(id);
    if (!ref) return null;
    const group = this.groups.get(ref.group);
    const inst = group?.instances[ref.slot];
    if (!group || !inst) return null;
    if (!group.geo.boundingBox) group.geo.computeBoundingBox();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(inst.x, inst.y, inst.z),
      new THREE.Quaternion().setFromAxisAngle(UP_AXIS, inst.rotationY),
      new THREE.Vector3(inst.scaleX, inst.scaleY, inst.scaleZ),
    );
    return group.geo.boundingBox!.clone().applyMatrix4(m);
  }

  /** The object whose MESH the pointer ray hits first — canopy, roof, or wall,
   *  not the ground cell under it. Terrain closer than the mesh occludes (null
   *  falls back to footprint hit-testing on the picked cell). */
  pickObjectAt(sx: number, sy: number): string | null {
    const rect = (this.renderer.domElement as HTMLCanvasElement).getBoundingClientRect();
    const ndc = new THREE.Vector2(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    let best: { dist: number; id: string } | null = null;
    for (const [key, group] of this.groups) {
      if (group.mesh.count === 0) continue;
      for (const hit of rc.intersectObject(group.mesh, false)) {
        if (hit.instanceId === undefined) continue;
        const id = this.slots.idAt(key, hit.instanceId);
        if (!id) continue;
        if (!best || hit.distance < best.dist) best = { dist: hit.distance, id };
      }
    }
    if (!best) return null;
    // Terrain in front of the mesh wins (a hill hides the tree behind it).
    const surface = pickSurface(this.meshState(), {
      x: rc.ray.origin.x, y: rc.ray.origin.y, z: rc.ray.origin.z,
    }, { x: rc.ray.direction.x, y: rc.ray.direction.y, z: rc.ray.direction.z });
    if (surface) {
      const d = Math.hypot(surface.point.x - rc.ray.origin.x, surface.point.y - rc.ray.origin.y, surface.point.z - rc.ray.origin.z);
      if (d < best.dist - 0.05) return null;
    }
    return best.id;
  }

  /** This scene as the tool layer's active view: surface-pick projection +
   *  the decal overlay. Created on first request; the overlay group joins the
   *  scene then (the read-only preview never pays for it). */
  asEditorView(): ActiveView {
    if (!this.editorView) {
      const overlay = new Overlay3D(() => this.meshState(), this.requestRender, (id) => this.objectBoundingBox(id));
      this.scene.add(overlay.group);
      this.overlay3d = overlay;
      this.editorView = {
        rendersState: () => this.liveState,
        onNextPaint: (cb: () => void) => this.onNextPaint(cb),
        projection: new Projection3D({
          camera: this.camera,
          canvas: this.renderer.domElement as HTMLCanvasElement,
          state: () => this.meshState(),
          panCamera: (dx, dy) => this.panCamera(dx, dy),
          pickObjectAt: (sx, sy) => this.pickObjectAt(sx, sy),
          objectBoundingBox: (id) => this.objectBoundingBox(id),
        }),
        overlay,
        leftDragPans: false,
        applyCameraTransform: () => this.requestRender(),
        // Under reduced motion neither decorative tween is registered: the instance already carries
        // its canonical transform, so skipping goes straight to the settled pose. The spin still has
        // to dirty the FROZEN shadow map by hand, since no tick will run to do it.
        plopObject: (id: string) => {
          if (!isMotionReduced()) this.plops.set(id, performance.now());
          this.requestRender();
        },
        animateRotation: (id: string, fromDeg: number, toDeg: number, onFrame?: (eased: number) => void) => {
          if (isMotionReduced()) this.renderer.shadowMap.needsUpdate = true;
          else this.spins.set(id, { from: fromDeg, to: toDeg, born: performance.now(), onFrame });
          this.requestRender();
        },
        animateGroupRotation: (turn: GroupRotation, onFrame?: (eased: number) => void) => {
          if (isMotionReduced()) this.renderer.shadowMap.needsUpdate = true;
          else {
            const members = turn.members.map((m) => ({
              id: m.id, spun: m.spun, motion: arcMotion(turn.pivot, m.from),
              roadTrim: bodyRoute(this.liveState, m.id) === 'roadTrim',
            }));
            this.groupArc = {
              born: performance.now(),
              sweepRad: (turn.sweepDeg * Math.PI) / 180,
              members,
              hasRoadTrim: members.some((m) => m.roadTrim),
              onFrame,
            };
          }
          this.requestRender();
        },
        // No animateRemove: `deleteGroup` fires this hook, then removes the object, then execute()
        // emits objects-changed SYNCHRONOUSLY — this scene's own listener frees the departing
        // instance's slot and repacks a different object into it before any render frame runs. A
        // tween would need a decoy mesh outside the InstancedMesh's dense packing, which this view
        // does not have; the object simply disappears with the InstancedMesh's next repaint.
        camera: this.cameraVerbs(),
      };
    }
    return this.editorView;
  }

  /** The camera verbs on their own, without the editing overlay `asEditorView` builds. The shot
   *  editor drives the same camera through the same gestures and never needs ghosts or rings. */
  cameraVerbs(): ViewCamera {
    if (!this.verbs) {
      this.verbs = {
        pan: (dx, dy) => this.dragCamera('pan', dx, dy),
        // Both eased through the zoom accumulator, so a notch reads as a short glide rather than a
        // jump and a run of them adds up into one continuous move — the same treatment the orbit
        // verb gets.
        zoomStep: (dir) => this.dollyEased(dir > 0 ? 1 / 1.15 : 1.15),
        zoomBy: (factor) => this.dollyEased(1 / factor),
        zoomStepAnimated: (dir) => this.animateDolly(dir > 0 ? 0.8 : 1.25), // toolkit button: glide
        orbit: (dx, dy) => this.dragCamera('orbit', dx, dy),
        // Twist arrives in radians, not screen px, so it is applied raw: feeding it to the inertia
        // would mix units into one velocity.
        orbitTwist: (dRad) => this.orbitBy(-dRad, 0),
        tilt: (v) => this.animateTilt(v),      // toolkit tilt steppers: glide
        fitToMap: () => this.animateFit(),     // toolkit fit: glide
        endGesture: () => {
          // Decorative continuation the user did not ask for: under reduced motion the camera
          // stops where the hand left it.
          if (isMotionReduced()) this.inertia.cancel();
          else this.inertia.release(performance.now());
        },
        wheelZooms: true, // scroll dollies (a ground-plane pan would read as W/S)
      };
    }
    return this.verbs;
  }

  private verbs: ViewCamera | null = null;
  private inertia = new CameraInertia();
  private inertiaMode: 'orbit' | 'pan' = 'pan';
  /**
   * The dolly's own accumulator. It holds the LOG of the pending distance factor, because a dolly
   * composes by multiplication and the accumulator adds: log turns "1.15 then 1.15" into one
   * additive 2x0.14 that drains to the same place. Its floor is therefore in log units, not pixels
   * (0.0008 is under a tenth of a percent of distance), and it follows a little slower than a drag
   * — a wheel notch is a discrete event with no hand to keep up with, so it can afford to glide.
   */
  private zoomInertia = new CameraInertia({ minTravel: 0.0008, followTau: 90 });

  /** Screen px of drag → radians of orbit. The one place the two units meet, so the live drag and
   *  the glide that follows it cannot use different rates. */
  private static readonly ORBIT_RAD_PER_PX = 0.005;

  /** Apply travel through one of the two drag verbs. */
  private applyDrag(mode: 'orbit' | 'pan', dx: number, dy: number): void {
    if (mode === 'orbit') {
      this.orbitBy(dx * ThreeScene.ORBIT_RAD_PER_PX, dy * ThreeScene.ORBIT_RAD_PER_PX);
    } else {
      this.panCamera(dx, dy);
    }
  }

  /**
   * A drag step. It is NOT applied here: it goes into the inertia accumulator and the render loop
   * drains it, which is what gives the camera weight going in as well as coming out. Reduced motion
   * skips the accumulator entirely and applies the step at once.
   */
  private dragCamera(mode: 'orbit' | 'pan', dx: number, dy: number): void {
    this.landIntro();
    if (isMotionReduced()) { this.applyDrag(mode, dx, dy); return; }
    if (mode !== this.inertiaMode) {
      // Travel measured while orbiting must never be applied as a pan. Hand back what is owed
      // through the verb that earned it, then switch.
      const owed = this.inertia.flush();
      if (owed) this.applyDrag(this.inertiaMode, owed.dx, owed.dy);
      this.inertiaMode = mode;
    }
    this.inertia.sample(dx, dy, performance.now());
    this.requestRender(); // nothing moved yet — the loop has to run to drain it
  }

  /** One frame of the camera catching up: the tail of a live drag, or the glide after one.
   *  Returns whether the camera moved. */
  private tickInertia(): boolean {
    const now = performance.now();
    let moved = false;
    const step = this.inertia.step(now);
    if (step) { this.applyDrag(this.inertiaMode, step.dx, step.dy); moved = true; }
    const zoom = this.zoomInertia.step(now);
    if (zoom) { this.dollyBy(Math.exp(zoom.dx)); moved = true; }
    return moved;
  }

  /** A wheel/pinch dolly, eased. Reduced motion applies it outright: the smoothing is decoration,
   *  and the zoom itself is not. */
  private dollyEased(factor: number): void {
    this.landIntro();
    if (isMotionReduced()) { this.dollyBy(factor); return; }
    this.zoomInertia.sample(Math.log(factor), 0, performance.now());
    this.requestRender();
  }

  // ── Editor camera verbs ────────────────────────────────────────────────────
  // The editor pointer machine drives the camera imperatively (OrbitControls'
  // own pointer handling is disabled in editor mode); these implement the same
  // constrained moves: yaw/pitch around the orbit target, clamped dolly, and a
  // ground-plane pan whose screen-pixel scale matches what the eye expects at
  // the current distance.

  /** Yaw/pitch the camera around the orbit target (radians). */
  orbitBy(dYaw: number, dPitch: number): void {
    this.landIntro();
    const t = this.controls.target;
    const offset = new THREE.Vector3().subVectors(this.camera.position, t);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta -= dYaw;
    sph.phi = Math.max(this.controls.minPolarAngle, Math.min(this.controls.maxPolarAngle, sph.phi - dPitch));
    sph.makeSafe();
    offset.setFromSpherical(sph);
    this.camera.position.copy(t).add(offset);
    this.camera.lookAt(t);
    this.requestRender();
  }

  /** Scale the orbit distance (factor > 1 moves away), clamped to the controls' range. */
  dollyBy(factor: number): void {
    const t = this.controls.target;
    const offset = new THREE.Vector3().subVectors(this.camera.position, t);
    const d = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, offset.length() * factor));
    offset.setLength(d);
    this.camera.position.copy(t).add(offset);
    this.requestRender();
  }

  /** Ground-plane pan by SCREEN pixel deltas along the camera's ground axes.
   *  Sign contract matches the 2D pan verb: pan(+dx, +dy) slides the VIEW
   *  right/down in screen terms — screen-down is ground-BACKWARD from the
   *  camera, so W (screen-up) walks the camera forward, camera-relative. */
  panCamera(dx: number, dy: number): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const h = this.container.clientHeight || 1;
    const worldPerPx = (2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1); else fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3()
      .addScaledVector(right, dx * worldPerPx)
      .addScaledVector(fwd, -dy * worldPerPx);
    this.camera.position.add(move);
    this.controls.target.add(move);
    this.clampTarget();
    this.requestRender();
  }

  /** The orbit target stays over the map (small margin) — panning can never
   *  strand the camera over empty void, mirroring the 2D pan bounds. */
  private clampTarget(): void {
    const off = mapCenterOffset(this.liveState.template.width, this.liveState.template.height);
    const m = 4;
    const t = this.controls.target;
    const cx = Math.max(-off.x - m, Math.min(off.x + m, t.x));
    const cz = Math.max(-off.z - m, Math.min(off.z + m, t.z));
    this.camera.position.x += cx - t.x;
    this.camera.position.z += cz - t.z;
    t.x = cx;
    t.z = cz;
  }

  /** Editor mode: the pointer machine owns all pointer input; the controls'
   *  own listeners would double-handle drags. */
  setEditorInput(on: boolean): void {
    this.controls.enabled = !on;
    this.editorInput = on;
  }

  private editorInput = false;

  /** Camera tilt as 0..1 across the polar clamp range (0 = low horizon sweep,
   *  1 = the steepest permitted look-down). */
  setTilt(v: number): void {
    const t = this.controls.target;
    const offset = new THREE.Vector3().subVectors(this.camera.position, t);
    const sph = new THREE.Spherical().setFromVector3(offset);
    const clamped = Math.max(0, Math.min(1, v));
    sph.phi = this.controls.maxPolarAngle + (this.controls.minPolarAngle - this.controls.maxPolarAngle) * clamped;
    sph.makeSafe();
    offset.setFromSpherical(sph);
    this.camera.position.copy(t).add(offset);
    this.camera.lookAt(t);
    this.requestRender();
  }

  /** Snap the camera to the resting whole-map framing (instant). */
  fitCamera(): void {
    this.camera.position.copy(this.introTo);
    this.controls.target.copy(this.introTarget);
    this.camera.lookAt(this.introTarget);
    this.controls.update();
    this.requestRender();
  }

  /** Start an eased glide of the camera pose (position + orbit target) toward a
   *  goal — the toolkit zoom/tilt/fit buttons use this so the view slides instead
   *  of jumping. A new glide replaces any in flight (held buttons chase smoothly). */
  private startCamTween(toPos: THREE.Vector3, toTgt: THREE.Vector3, dur = 260): void {
    // Reduced motion: land on the goal pose immediately instead of gliding. One chokepoint, so every
    // toolkit glide (zoom steppers, tilt steppers, fit-to-map) is covered.
    if (isMotionReduced()) {
      this.camera.position.copy(toPos);
      this.controls.target.copy(toTgt);
      this.camera.lookAt(this.controls.target);
      this.camTween = null;
      this.controls.update();
      this.bus?.emit('viewport-changed', { zoom: this.zoomPercent() / 100 });
      this.requestRender();
      return;
    }
    this.camTween = {
      startMs: performance.now(), dur,
      fromPos: this.camera.position.clone(), toPos: toPos.clone(),
      fromTgt: this.controls.target.clone(), toTgt: toTgt.clone(),
    };
    this.requestRender();
  }

  private animateCamTween(): void {
    const tw = this.camTween;
    if (!tw) return;
    const raw = Math.min(1, (performance.now() - tw.startMs) / tw.dur);
    const t = 1 - Math.pow(1 - raw, 3); // easeOutCubic
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, t);
    this.controls.target.lerpVectors(tw.fromTgt, tw.toTgt, t);
    this.camera.lookAt(this.controls.target);
    this.bus?.emit('viewport-changed', { zoom: this.zoomPercent() / 100 });
    if (raw >= 1) { this.camTween = null; this.controls.update(); }
  }

  /** Toolkit ZOOM: glide the orbit distance by `factor` (>1 = away), clamped. */
  animateDolly(factor: number): void {
    this.landIntro();
    const t = this.controls.target;
    const offset = new THREE.Vector3().subVectors(this.camera.position, t);
    const d = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, offset.length() * factor));
    offset.setLength(d);
    this.startCamTween(t.clone().add(offset), t.clone());
  }

  /** Toolkit TILT: glide to tilt value v (0..1 across the polar clamp range). */
  animateTilt(v: number): void {
    this.landIntro();
    const t = this.controls.target;
    const offset = new THREE.Vector3().subVectors(this.camera.position, t);
    const sph = new THREE.Spherical().setFromVector3(offset);
    const clamped = Math.max(0, Math.min(1, v));
    sph.phi = this.controls.maxPolarAngle + (this.controls.minPolarAngle - this.controls.maxPolarAngle) * clamped;
    sph.makeSafe();
    offset.setFromSpherical(sph);
    this.startCamTween(t.clone().add(offset), t.clone());
  }

  /** Toolkit FIT: glide back to the resting whole-map framing. */
  animateFit(): void {
    this.landIntro();
    this.startCamTween(this.introTo.clone(), this.introTarget.clone());
  }

  /** The dolly distance as a share of the fit distance — the zoom readout. */
  zoomPercent(): number {
    const fit = this.introTo.distanceTo(this.introTarget);
    const cur = this.camera.position.distanceTo(this.controls.target);
    return Math.round((fit / Math.max(0.01, cur)) * 100);
  }

  /** Halt the render loop while this view is hidden (the canvas stays alive and
   *  its GL resources warm); resume() restarts it. No-ops after dispose(). */
  pause(): void {
    this.running = false;
    this.inertia.cancel(); // a glide must not resume when the view comes back, minutes later
    this.zoomInertia.cancel();
    cancelAnimationFrame(this.raf);
  }

  resume(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    if (this.objectsStale) {
      this.objectsStale = false;
      this.resetObjects();
    }
    this.requestRender();
    this.loop();
  }

  /** Rebuild the instanced-object set from the live map: every slot, road id, elevation record and
   *  in-flight per-object animation is bookkeeping about a set this scene stopped mirroring. The
   *  group meshes stay (capacity is reusable); only their counts and instances are rewritten. */
  private resetObjects(): void {
    for (const group of this.groups.values()) group.mesh.count = 0;
    this.slots = new InstanceSlots();
    this.roadIds.clear();
    this.objElevation.clear();
    this.plops.clear();
    this.spins.clear();
    this.groupArc = null;
    this.buildObjects(this.liveState);
    this.roadTrimDirty = true;
    this.iconRefineDirty = true;
    this.chromeNudgeDirty = true;
    this.renderer.shadowMap.needsUpdate = true;
  }

  private disposed = false;

  dispose(): void {
    this.disposed = true;
    this.running = false;
    this.notifyPainted();  // a disposed scene never draws again; a waiter must not hang on it
    cancelAnimationFrame(this.raf);
    this.busDetach?.();
    this.overlay3d?.dispose();
    this.annotations3d.dispose();
    for (const chunk of this.terrainChunks.values()) {
      for (const geo of chunk.geometries) geo.dispose();
    }
    this.terrainChunks.clear();
    for (const geo of this.roadTrimGeos) geo.dispose(); // their materials/textures ride `disposables`
    this.roadTrimGeos = [];
    this.roadTrimMeshes = [];
    window.removeEventListener('resize', this.onResize);
    this.boxWatch?.disconnect();
    this.boxWatch = null;
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.dispose();
    // Free per-instance buffers (instanceMatrix/instanceColor). NOT their
    // geometry — that's the shared archetype geometry, freed by disposeArchetypes().
    for (const mesh of this.instanced) mesh.dispose();
    for (const d of this.disposables) d.dispose();
    disposeArchetypes();
    disposeModels();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
