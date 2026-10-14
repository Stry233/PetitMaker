/*
 * The Help Center's save/share/search figures: the real save offer, export and
 * checklist panels, the layer stack, a row of generate candidates and a row of search results,
 * each mounted live inside `PreviewFrame` rather than drawn as a picture of itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderThumbnail } from '../../../../view/map2d/capture/thumbnail';
import type { GridState, MapNotes } from '../../../../core/model/types';
import type { Locale } from '../../../../core/model/locale';
import { WATER_COLOR } from '../../../../core/model/palette';
import { DEFAULT_MAP } from '../../../../config/maps';
import { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import { useInView } from '../use-in-view';
import { useFigureReady } from '../figure-ready';
import { figureCaption } from '../caption';
import { DEFAULT_EXPORT_OPTIONS as DEFAULT_OPTIONS, DEFAULT_FOOTER, formatFooterDate, isImportable, type ExportOptions } from '../../../../io/export/facts';
import { buildChecklist } from '../../../../state/build-checklist';
import { useEditorStore } from '../../../../state/store';
import { isMotionReduced } from '../../../../platform/channels/motion-state';
import { useLocale, useT } from '../../../../i18n/context';
import { searchExamples } from '../../search-examples';
import { cozyPanel, windowCard } from '../../../design/window-skin';
import { ScaleProvider } from '../../../design/scale';
import { SHELF_SCALE } from '../../../shell/units';
import { RestoreShelf } from '../../../shell/bars/generate/RestoreShelf';
import { CandidateCard } from '../../../shell/bars/generate/CandidateCard';
import { ObjectShelf } from '../../../shell/bars/objects/ObjectShelf';
import { CARD } from '../../../shell/bars/generate/generate-shelf';
import { IMPORT_CARD_WIDTH } from '../../../chrome/modals/import/ImportDropZone';
import { WINDOW_PADDING, WindowHeader } from '../../../primitives/Window';
import { ImportCardBody } from '../../../chrome/modals/import/ImportModal';
import { ShareWindow, ShareWindowHead, type ShareSection } from '../../../chrome/modals/export/ShareWindow';
import { ExportPreview } from '../../../chrome/modals/export/ExportPreview';
import { ExportControls } from '../../../chrome/modals/export/ExportControls';
import { FooterEditor } from '../../../chrome/modals/export/FooterEditor';
import { footerTokenValues } from '../../../../editor/export/preview';
import { DirectionBooklet } from '../../../chrome/modals/export/stylize/DirectionBooklet';
import { Studio } from '../../../chrome/modals/export/stylize/Studio';
import { STUDIO_CARD } from '../../../chrome/modals/export/stylize/StylizeWindow';
import { connectionTarget } from '../../../../editor/export/stylize';
import { useShareCode } from '../../../chrome/modals/export/use-share-code';
import { BuildChecklist } from '../../../chrome/modals/export/BuildChecklist';
import { PreviewFrame } from './PreviewFrame';
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

/** The modal's own card, exactly as `ModalShell` builds it (`cozyPanel` first, the window's plate
 *  fill spread over it): the figures below stand inside the same chrome the live windows do. */
const cardChrome = { ...cozyPanel, ...windowCard, boxSizing: 'border-box' as const };

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
function ShareWindowFigure({ section, width, height, zoom }: { section: ShareSection; width: number; height: number; zoom: number }) {
  return (
    <PreviewFrame width={Math.round(width * zoom)} height={Math.round(height * zoom) + 28} zoom={zoom} align="top">
      <div style={{ position: 'relative', width, height }}>
        <ShareWindow open section={section} />
      </div>
    </PreviewFrame>
  );
}

export function ShareWindowPreview() {
  return <ShareWindowFigure section="friend" width={980} height={848} zoom={0.56} />;
}

/** The Import map card as it stands when the menu opens it: the real drop zone at the modal's own
 *  geometry. The no-op click keeps the modal's click-to-choose line, which the drop zone swaps for
 *  the drag-only wording when the handler is absent. */
export function ImportPreview() {
  return (
    <PreviewFrame height={310}>
      <div style={{ ...cardChrome, width: IMPORT_CARD_WIDTH, padding: WINDOW_PADDING }}>
        <ImportCardBody dragOver={false} busy={false} onClick={() => {}} onClose={() => {}} />
      </div>
    </PreviewFrame>
  );
}

export function JsonPreview() {
  return <ShareWindowFigure section="keep" width={560} height={700} zoom={0.6} />;
}

/** The checklist over the figure's own finished map, which the live window cannot show for an empty one. */
function ChecklistHead() {
  const [tab, setTab] = useState<ShareSection>('game');
  return <ShareWindowHead section={tab} onPick={setTab} onClose={() => {}} />;
}

export function ChecklistPreview() {
  const shown = useShownMap();
  return (
    <PreviewFrame width={372} height={456} zoom={0.6} align="top">
      <div style={{ ...cardChrome, width: 620, height: 760, padding: WINDOW_PADDING, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ChecklistHead />
        <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
          {shown && <BuildChecklist subject={shown} />}
        </div>
      </div>
    </PreviewFrame>
  );
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
  return (
    <PreviewFrame width={372} height={430} zoom={0.6} align="top">
      <div style={{ ...cardChrome, width: 620, height: 760, padding: WINDOW_PADDING, overflow: 'hidden' }}>
        {subject && <BuildChecklist subject={subject} />}
      </div>
    </PreviewFrame>
  );
}

const CANDIDATE_SEEDS = [4127, 90210, 5551];

/** Each card's shot photographs that seed's own designed run, cached per session: three cards
 *  showing three different maps, which is the fact the candidates page teaches. */
const candidateShots = new Map<number, string>();
async function candidateShot(seed: number, aspect: number): Promise<string | null> {
  const hit = candidateShots.get(seed);
  if (hit) return hit;
  const world = new SandboxWorld();
  world.beginStroke();
  world.generateDesigned({ seed, richness: 0.7, maxElevation: 4, mode: 'mixed', region: null });
  world.commit();
  const png = await renderThumbnail(world.state, 480, aspect);
  if (png) candidateShots.set(seed, png);
  return png;
}

export function CandidatesPreview() {
  const [shots, setShots] = useState<Array<string | undefined>>(() => CANDIDATE_SEEDS.map(() => undefined));
  const hostRef = useRef<HTMLDivElement>(null);
  // Three designed runs: they wait for the reader to approach the figure.
  const inView = useInView(hostRef);

  useEffect(() => {
    if (!inView) return undefined;
    let dropped = false;
    // Sequential, a breath apart: each shot is a real designed run, and three at once would stall
    // the frame the figure arrives on. A shot that resolves null keeps its loading dots.
    let chain = Promise.resolve();
    CANDIDATE_SEEDS.forEach((seed, i) => {
      chain = chain.then(async () => {
        if (dropped) return;
        await new Promise((resolve) => setTimeout(resolve, 30));
        const png = await candidateShot(seed, CARD.pic.w / CARD.pic.h);
        if (!dropped && png) setShots((prev) => prev.map((s, j) => (j === i ? png : s)));
      });
    });
    return () => { dropped = true; };
  }, [inView]);

  const cardW = Math.round(CARD.w * SHELF_SCALE);
  const cardH = Math.round(CARD.h * SHELF_SCALE);

  return (
    <PreviewFrame width={cardW * 3 + 48} height={cardH + 24}>
      <ScaleProvider value={SHELF_SCALE}>
        <div ref={hostRef} style={{ display: 'flex', gap: 16 }}>
          {CANDIDATE_SEEDS.map((seed, i) => (
            <div key={seed} style={{ width: cardW }}>
              <CandidateCard seed={seed} shot={shots[i]} selected={i === 1} onSelect={() => {}} />
            </div>
          ))}
        </div>
      </ScaleProvider>
    </PreviewFrame>
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
  const still = useRef(isMotionReduced());
  const [step, setStep] = useState(() => (still.current ? frozenStep : 0));
  const [typed, setTyped] = useState(() => (still.current ? [...steps[frozenStep]!.query].length : 0));

  useEffect(() => {
    if (still.current) return undefined;
    const length = [...steps[step % steps.length]!.query].length;
    const timer = setTimeout(() => {
      if (typed < length) { setTyped(typed + 1); return; }
      setStep((step + 1) % steps.length);
      setTyped(0);
    }, typed < length ? TYPE_MS : HOLD_MS);
    return () => clearTimeout(timer);
  }, [step, typed, steps]);

  const active = steps[step % steps.length]!;
  const query = [...active.query].slice(0, typed).join('');

  return (
    // Full width, stated: the figure box centers its child with shrink-to-fit sizing, and a
    // wrapper without a width would collapse the frame (and the shelf in it) to content width.
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 13, width: '100%' }}>
      <PreviewFrame height={230} zoom={0.62} align="top">
        <ObjectShelf posedQuery={query} />
      </PreviewFrame>
      <div style={figureCaption({ role: 'lead', padding: '6px 18px', shadow: true, nowrap: true })}>
        {t(active.captionKey)}
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
    <PreviewFrame height={400} zoom={0.72} align="top">
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
    <PreviewFrame height={210} zoom={0.72}>
      <div style={{ height: 290, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        <div style={{ width: 340 }}>
          <ExportControls options={options} setOptions={setOptions} notes={{}} setNotes={() => {}} summary={null} footerSamples={samples} initialOpen />
        </div>
      </div>
    </PreviewFrame>
  );
}

/* ── the illustration studio, whole: title, booklet, canvas, shelf, foot ──── */

/** Six is past the studio's own shelf slots, and the pose never generates. */
const STUDIO_FIG_HEIGHT = 380;

export function StylizeStudioPreview() {
  const t = useT();
  const state = useShownMap();
  const [original, setOriginal] = useState<string | null>(null);
  useEffect(() => {
    if (!state) return undefined;
    let live = true;
    void renderThumbnail(state, 720).then((png) => { if (live) setOriginal(png); });
    return () => { live = false; };
  }, [state]);
  return (
    <PreviewFrame height={STUDIO_FIG_HEIGHT} zoom={0.52} align="top">
      <div style={{ ...cardChrome, width: STUDIO_CARD.width, height: STUDIO_CARD.height, padding: WINDOW_PADDING, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <WindowHeader title={<h2 style={{ margin: 0, font: 'inherit' }}>{t('stylize.win_title')}</h2>} reserve close={{ label: t('hint.close'), onPress: () => {} }} style={{ flex: 'none' }} />
        {original && (
          <Studio
            dialect={connectionTarget('gemini', { key: '', baseUrl: '', model: '' }).dialect}
            connected
        cfg={{ key: '', baseUrl: '', model: '' }}
            onSettings={() => {}}
            onDone={() => {}}
            captureOriginal={() => original}
          />
        )}
      </div>
    </PreviewFrame>
  );
}
