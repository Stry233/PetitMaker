/*
 * The Help Center's save/share/search figures: the real save offer, export and
 * checklist panels, the layer stack, a row of generate candidates and a row of search results,
 * each mounted live inside `PreviewFrame` rather than drawn as a picture of itself.
 */
import { useReducedMotionConfig } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GridState, MacroCoord, MapNotes } from '../../../../core/model/types';
import type { Locale } from '../../../../core/model/locale';
import { WATER_COLOR } from '../../../../core/model/palette';
import { DEFAULT_MAP } from '../../../../config/maps';
import { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import { useInView } from '../use-in-view';
import { useFigureReady } from '../figure-ready';
import { FIGURE_LEAST, useFigureRoom } from '../figure-scale';
import { figureCaption } from '../caption';
import { DEFAULT_EXPORT_OPTIONS as DEFAULT_OPTIONS, DEFAULT_FOOTER, formatFooterDate, isImportable, type ExportOptions } from '../../../../io/export/facts';
import { buildChecklist } from '../../../../state/build-checklist';
import { useEditorStore } from '../../../../state/store';
import { useLocale, useT } from '../../../../i18n/context';
import { searchExamples } from '../../search-examples';
import { ScaleProvider } from '../../../design/scale';
import { SHELF_SCALE } from '../../../shell/units';
import { RestoreShelf } from '../../../shell/bars/generate/RestoreShelf';
import { GenerateCards } from '../../../shell/bars/generate/GenerateCards';
import { CANDIDATES, CARD, GAP } from '../../../shell/bars/generate/generate-shelf';
import { useGenerateRecipe } from '../../../shell/bars/generate/use-generate-recipe';
import { useGeneratePreviews } from '../../../shell/bars/generate/use-generate-previews';
import type { StencilSample } from '../../../shell/bars/generate/stencil-samples';
import { batchKey } from '../../../../editor/editing/generate-batch';
import { IMPORT_CARD_WIDTH } from '../../../chrome/modals/import/ImportDropZone';
import { WINDOW_PADDING_X } from '../../../primitives/Window';
import { ImportModal } from '../../../chrome/modals/import/ImportModal';
import { ShareWindow, type ShareSection } from '../../../chrome/modals/export/ShareWindow';
import { ExportPreview } from '../../../chrome/modals/export/ExportPreview';
import { ExportControls } from '../../../chrome/modals/export/ExportControls';
import { FooterEditor } from '../../../chrome/modals/export/FooterEditor';
import { footerTokenValues } from '../../../../editor/export/preview';
import { DirectionBooklet } from '../../../chrome/modals/export/stylize/DirectionBooklet';
import { STUDIO_CARD, StylizeWindow } from '../../../chrome/modals/export/stylize/StylizeWindow';
import { useShareCode } from '../../../chrome/modals/export/use-share-code';
import { ShelfOverMap } from './strips';
import { PreviewFrame } from './PreviewFrame';
import { useWindowSnapshot } from './frame-overview';
import { useLayoutShape } from '../../../design/input-mode';
import type { UiPreviewPose } from '../../../design/preview';
import { bareGridState } from '../../../../core/model/template';
import type { TextKey } from '../../../../i18n/keys';

/** The map every figure below stands in for its subject: the visitor's own, or the default
 *  template's bare ground while it is not yet loaded. */
function useFigureGridState(): GridState {
  const live = useEditorStore((s) => s.gridState);
  const fallback = useMemo(() => live ?? bareGridState(DEFAULT_MAP), [live]);
  return live ?? fallback;
}

/** Use the reader's nonempty map, or one shared generated map after figure admission. */
export function useShownMap(): GridState | null {
  const ready = useFigureReady();
  const live = useEditorStore((s) => s.gridState);
  const liveHasContent = ready && live !== null && checklistHasContent(live);
  const [island, setIsland] = useState<GridState | null>(null);
  useEffect(() => {
    if (!ready || liveHasContent) return undefined;
    const timer = setTimeout(() => setIsland(fullIslandState()), 0);
    return () => clearTimeout(timer);
  }, [ready, liveHasContent]);
  return liveHasContent ? live : island;
}

export function SavePreview() {
  const state = useShownMap();
  return (
    <PreviewFrame height={230} style={{ background: WATER_COLOR }}>
      {/* `splashActive` holds the offer's countdown still: without it TimedButton's timer fires a
          programmatic click that `pointer-events: none` does not stop. */}
      {state && <RestoreShelf state={state} splashActive onRestore={() => {}} onDismiss={() => {}} />}
    </PreviewFrame>
  );
}

/** A fixed creation date, so the figure's band is the same picture every visit. */
const SHARE_CREATED_AT = new Date(0).toISOString();

/** The export window's own defaults, so the figure pictures the window as it opens. */
const SHARE_OPTIONS: ExportOptions = DEFAULT_OPTIONS;

export function SharePreview() {
  const ready = useFigureReady();
  // The window pictures the visitor's own map: its map band captures the live view, so the code
  // band must encode the same map or the two halves of the picture would disagree.
  const state = useEditorStore((st) => st.gridState);
  const code = useShareCode(ready, state, {
    summary: null, importable: isImportable(SHARE_OPTIONS), resolution: SHARE_OPTIONS.resolution, createdAt: SHARE_CREATED_AT,
  });
  return (
    <PreviewFrame width={640} height={508}>
      <div style={{ display: 'flex', flexDirection: 'column', width: 640, height: 508, boxSizing: 'border-box' }}>
        <ExportPreview
          open
          options={SHARE_OPTIONS}
          summary={null}
          codeImg={code.asset?.canvas ?? null}
          codePending={code.pending}
          codeIssue={code.issue}
        />
      </div>
    </PreviewFrame>
  );
}

/** The Save and share window itself, the live component posed open at one section, so a page's first
 *  picture is the whole window the button opens. */
function ShareWindowFigure({ section, width, height, subject }: { section: ShareSection; width: number; height: number; subject?: GridState }) {
  return (
    <PreviewFrame width={width} height={height + 28} align="top">
      <div style={{ position: 'relative', width, height }}>
        <ShareWindow open section={section} {...(subject ? { subject } : {})} />
      </div>
    </PreviewFrame>
  );
}

export function ShareWindowPreview() {
  return <ShareWindowFigure section="friend" width={980} height={848} />;
}

/** The Import map window as the menu opens it: the live window, posed open. */
export function ImportPreview() {
  return (
    <PreviewFrame height={IMPORT_FIG_HEIGHT} align="top">
      <div style={{ position: 'relative', width: IMPORT_CARD_WIDTH + 2 * WINDOW_PADDING_X, height: IMPORT_FIG_HEIGHT }}>
        <ImportModal open onClose={() => {}} />
      </div>
    </PreviewFrame>
  );
}

/** The import window's whole height at live size, its drop zone and buttons. */
const IMPORT_FIG_HEIGHT = 360;

export function JsonPreview() {
  return <ShareWindowFigure section="keep" width={560} height={700} />;
}

/** The checklist tab of the live window over the figure's own finished map, which the live window
 *  cannot show for an empty one. */
export function ChecklistPreview() {
  const shown = useShownMap();
  return <ShareWindowFigure section="game" width={620} height={760} {...(shown ? { subject: shown } : {})} />;
}

/** Whether a map's checklist would list anything at all. */
function checklistHasContent(state: GridState): boolean {
  const list = buildChecklist(state);
  return list.groups.some((g) => g.items.length > 0) || list.roads.length > 0 || list.layers.length > 0;
}

/** A finished map, built once per session by the real designed generator, so the full-list
 *  figure shows the checklist the way a real build fills it. */
let fullIsland: GridState | null = null;
export function fullIslandState(): GridState {
  if (fullIsland) return fullIsland;
  const world = new SandboxWorld();
  world.beginStroke();
  world.generateDesigned({ seed: 20260830, richness: 0.9, maxElevation: 4, mode: 'mixed', region: null });
  world.commit();
  fullIsland = world.state;
  return fullIsland;
}

/** The full checklist uses the real generator and checklist, once its figure is admitted. */
export function FullChecklistPreview() {
  const ready = useFigureReady();
  const [subject, setSubject] = useState<GridState | null>(null);
  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => setSubject(fullIslandState()), 0);
    return () => clearTimeout(timer);
  }, [ready]);
  return <ShareWindowFigure section="game" width={620} height={760} {...(subject ? { subject } : {})} />;
}

/** The candidates page's shelf kind: the planet's own recipe cards. */
const CANDIDATES_KIND = 'island' as const;
const noop = () => {};
const pass = () => true;

/** The generate shelf's real card row, dealt and built by the real batch against a sandbox of the
 *  default planet, so every card is a run of its own recipe number on that map. */
function CandidateRow() {
  const [world] = useState(() => new SandboxWorld());
  const recipe = useGenerateRecipe(CANDIDATES_KIND, noop);
  const { kind, base, customSeed, richness, elevation, corridorWidth } = recipe;
  const settings = { kind, richness, maxElevation: elevation, corridorWidth, gates: null };
  const recipeKey = batchKey({ kind, richness, maxElevation: elevation, corridorWidth, gates: null, stencil: null });
  const previews = useGeneratePreviews({
    gridState: world.state, region: NO_REGION, selectingRegion: false, settings, base, customSeed, hand: NO_HAND, ownSample: null,
    fontsReady: true, ownFontsReady: true, planInputs: null, wordFits: pass, fits: true, recipeKey,
    forgetApplied: noop, clearFailed: noop, kit: world.kit,
  });
  const cardW = Math.round(CARD.w * SHELF_SCALE);
  return (
    <GenerateCards
      recipe={recipe}
      cardW={cardW}
      view={{
        shots: previews.shots, customShot: previews.customShot, appliedIndex: null, failedIndex: null, landingIndex: null,
        noteFor: () => null, ownNote: null, ownAllowed: true, ownPending: false, hand: NO_HAND, onSelect: noop,
      }}
      style={{ display: 'flex', alignItems: 'stretch', flexWrap: 'nowrap', gap: GAP.card }}
    />
  );
}

const NO_REGION: MacroCoord[] = [];
const NO_HAND: StencilSample[] = [];

/** The air the figure keeps around the row, in the row's px. */
const ROW_AIR = 24;

export function CandidatesPreview() {
  const hostRef = useRef<HTMLDivElement>(null);
  // A real five-card batch: it waits for the reader to approach the figure.
  const inView = useInView(hostRef);
  const room = useFigureRoom();
  const cardW = Math.round(CARD.w * SHELF_SCALE);
  const cardH = Math.round(CARD.h * SHELF_SCALE);
  // The row as the live shelf shows it before a scroll: from its first card, as many whole cards as
  // the column holds at the figure rule's least share, its edge on the gap after the last of them.
  const fits = room > 0 ? Math.floor((room / FIGURE_LEAST - ROW_AIR + GAP.card) / (cardW + GAP.card)) : CANDIDATES + 1;
  const shown = Math.max(1, Math.min(CANDIDATES + 1, fits));
  const rowW = shown * (cardW + GAP.card) - GAP.card;
  return (
    <div ref={hostRef} style={{ width: '100%' }}>
      <PreviewFrame width={rowW + ROW_AIR} height={cardH + ROW_AIR}>
        <div style={{ width: rowW }}>
          <div style={{ width: rowW, overflow: 'hidden' }}>
            <ScaleProvider value={SHELF_SCALE}>
              {inView && <CandidateRow />}
            </ScaleProvider>
          </div>
        </div>
      </PreviewFrame>
    </div>
  );
}

/** One beat of the search figure's cycle: a query the page's own sections cite, captioned by the
 *  section title whose capability it demonstrates. */
interface SearchStep { query: string; captionKey: TextKey }

/**
 * Every locale walks the four capabilities the search sections document: a plain query, an
 * incomplete one, an alias and a multi-term and. Non-English locales add the English query, since
 * search matches English in every interface language. The queries are the ones the section prose
 * quotes, both read from `search-examples.ts`, so the figure and the copy cannot drift apart.
 */
function searchSteps(locale: Locale): readonly SearchStep[] {
  const e = searchExamples(locale);
  return locale === 'en'
    ? [
      { query: e.enQuery, captionKey: 'help.search.basic_t' },
      { query: e.enTypo, captionKey: 'help.search.typo_t' },
      { query: e.aliasLatin, captionKey: 'help.search.alias_t' },
      { query: e.wordsQuery, captionKey: 'help.search.multiword_t' },
    ]
    : [
      { query: e.item, captionKey: 'help.search.basic_t' },
      { query: e.typo, captionKey: 'help.search.typo_t' },
      { query: e.enQuery, captionKey: 'help.search.basic_t' },
      { query: e.aliasQuery, captionKey: 'help.search.alias_t' },
      { query: e.wordsQuery, captionKey: 'help.search.multiword_t' },
    ];
}

/** One typed character, and the finished query's hold with its results standing. */
const TYPE_MS = 130;
const HOLD_MS = 2400;

export function SearchPreview() {
  const locale = useLocale();
  const t = useT();
  const steps = useMemo(() => searchSteps(locale), [locale]);
  // Where the cycle stands frozen under reduced motion: the typo step, whichever index it falls
  // at in this locale's own table.
  const frozenStep = useMemo(() => {
    const idx = steps.findIndex((s) => s.captionKey === 'help.search.typo_t');
    return idx === -1 ? 0 : idx;
  }, [steps]);
  const still = useReducedMotionConfig() === true;
  const [step, setStep] = useState(() => (still ? frozenStep : 0));
  const [typed, setTyped] = useState(() => (still ? [...steps[frozenStep]!.query].length : 0));

  useEffect(() => {
    if (still) return undefined;
    const length = [...steps[step % steps.length]!.query].length;
    const timer = setTimeout(() => {
      if (typed < length) { setTyped(typed + 1); return; }
      setStep((step + 1) % steps.length);
      setTyped(0);
    }, typed < length ? TYPE_MS : HOLD_MS);
    return () => clearTimeout(timer);
  }, [step, typed, steps, still]);

  const active = steps[step % steps.length]!;
  const query = [...active.query].slice(0, typed).join('');

  return (
    // Full width, stated: the figure box centers its child with shrink-to-fit sizing, and a
    // wrapper without a width would collapse the frame (and the shelf in it) to content width.
    <div data-figure-sized style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 13, width: '100%' }}>
      <ShelfOverMap query={query} />
      {/* Every step's line in one cell, so the longest holds the room and a step moves nothing (UI-62). */}
      <div style={{ display: 'grid', maxWidth: '100%' }}>
        {[...new Set(steps.map((s) => s.captionKey))].map((key) => (
          <div key={key} style={{ gridArea: '1 / 1', justifySelf: 'center', alignSelf: 'start', textAlign: 'center', visibility: key === active.captionKey ? 'visible' : 'hidden', ...figureCaption({ role: 'lead', padding: '6px 18px', shadow: true }) }}>
            {t(key)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── the picture tab's settings column, posed at its own defaults ────────── */

/** The token values the footer menu shows, read off the figure's subject map. */
function useFooterSamples(options: ExportOptions): Record<string, string> {
  const locale = useLocale();
  const state = useFigureGridState();
  return useMemo(
    () => ({ ...footerTokenValues(state, options, locale, null), date: formatFooterDate() }),
    [state, options, locale],
  );
}

export function ExportControlsPreview() {
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_OPTIONS);
  const [notes, setNotes] = useState<MapNotes>({});
  const samples = useFooterSamples(options);
  return (
    <PreviewFrame height={556} align="top">
      <div style={{ width: 340 }}>
        <ExportControls options={options} setOptions={setOptions} notes={notes} setNotes={setNotes} summary={null} footerSamples={samples} />
      </div>
    </PreviewFrame>
  );
}

/* ── the footer editor, standing at the default template ─────────────────── */

export function FooterEditorPreview() {
  const t = useT();
  const [template, setTemplate] = useState<string>(DEFAULT_FOOTER);
  const samples = useFooterSamples(DEFAULT_OPTIONS);
  return (
    <PreviewFrame height={140}>
      <div style={{ width: 430 }}>
        <FooterEditor value={template} onChange={setTemplate} samples={samples} t={t} />
      </div>
    </PreviewFrame>
  );
}

/* ── the illustration studio's direction booklet ─────────────────────────── */

export function StylizeDirectionsPreview() {
  return (
    <PreviewFrame height={380} align="top">
      <div style={{ width: 400 }}>
        <DirectionBooklet value="watercolor" onPick={() => {}} />
      </div>
    </PreviewFrame>
  );
}

/* ── the appearance rows, posed open (one press past the column above) ───── */

export function ExportControlsOpenPreview() {
  // Footer and 3D posed off so the disclosure shows its rows, not their unfolded editors: the
  // footer editor and the shot strip each have a figure of their own. The crop hangs from the
  // column's bottom, where the Appearance block lives, so the rows stay in frame whatever height
  // the rows above them take in a given locale.
  const [options, setOptions] = useState<ExportOptions>({ ...DEFAULT_OPTIONS, footer: false, card3d: false });
  const samples = useFooterSamples(options);
  return (
    <PreviewFrame height={292}>
      <div style={{ height: 290, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        <div style={{ width: 340 }}>
          <ExportControls options={options} setOptions={setOptions} notes={{}} setNotes={() => {}} summary={null} footerSamples={samples} initialOpen />
        </div>
      </div>
    </PreviewFrame>
  );
}

/* ── the illustration studio, whole: the live window posed open over the figure's map ── */

/** The stylize window as the Share window opens it, over the figure's own map: its original is
 *  the window's own capture of that map, and the pose never generates or asks a provider. */
export function StylizeStudioPreview() {
  const state = useShownMap();
  const room = useFigureRoom();
  const upright = useLayoutShape() === 'portrait';
  const win = useWindowSnapshot();
  // Upright the window fills its screen, so it stands in a phone no wider than the column holds at the
  // figure rule's least share and no taller than the wide card, which keeps its foot in the picture.
  const w = upright ? (room > 0 ? Math.min(win.w, Math.floor(room / FIGURE_LEAST)) : win.w) : STUDIO_CARD.width;
  const h = upright ? Math.min(win.h, STUDIO_CARD.height) : STUDIO_CARD.height;
  const pose = useMemo<UiPreviewPose | undefined>(() => (upright ? { viewport: { w, h } } : undefined), [upright, w, h]);
  const screen = { w, h };
  return (
    <PreviewFrame width={screen.w} height={screen.h} align="top" {...(pose ? { pose } : {})}>
      <div style={{ position: 'relative', width: screen.w, height: screen.h }}>
        {state && <StylizeWindow subject={state} />}
      </div>
    </PreviewFrame>
  );
}
