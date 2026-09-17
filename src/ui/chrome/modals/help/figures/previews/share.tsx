/*
 * share.tsx — the Help Center's save/share/search figures: the real save offer, export and
 * checklist panels, the layer stack, a row of generate candidates and a row of search results,
 * each mounted live inside `PreviewFrame` rather than drawn as a picture of itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderThumbnail } from '../../../../../../canvas/thumbnail';
import type { GridState, Locale, MapNotes } from '../../../../../../core/model/types';
import { createGrid } from '../../../../../../core/model/grid-model';
import { WATER_COLOR } from '../../../../../../core/model/constants';
import { DEFAULT_MAP } from '../../../../../../config/maps';
import { generateDesigned } from '../../../../../../tools/generation/designer/pipeline';
import { DemoWorld } from '../demo-world';
import { useInView } from '../use-in-view';
import { useFigureReady } from '../figure-ready';
import { figureCaption } from '../caption';
import type { ExportOptions } from '../../../../../../io/export/types';
import { buildChecklist } from '../../../../../../state/build-checklist';
import { useEditorStore } from '../../../../../../state/store';
import { isMotionReduced } from '../../../../../../canvas/map2d/motion-state';
import { useT } from '../../../../../../i18n/context';
import { cozyPanel, windowCard, windowTitle } from '../../../../../design/window-skin';
import { ScaleProvider } from '../../../../../design/scale';
import { SHELF_SCALE } from '../../../../../shell/units';
import { RestoreShelf } from '../../../../../shell/bars/RestoreShelf';
import { CandidateCard } from '../../../../../shell/bars/CandidateCard';
import { ObjectShelf } from '../../../../../shell/bars/ObjectShelf';
import { CARD } from '../../../../../shell/bars/generate-shelf';
import { IMPORT_CARD_WIDTH, IMPORT_CARD_PADDING } from '../../../import/ImportDropZone';
import { ImportCardBody } from '../../../import/ImportModal';
import { ExportPanel } from '../../../export/ExportModal';
import { ShareWindowHead, type ShareSection } from '../../../../../shell/windows/ShareWindow';
import { ExportPreview } from '../../../export/ExportPreview';
import { ExportControls } from '../../../export/ExportControls';
import { FooterEditor } from '../../../export/FooterEditor';
import { footerTokenValues } from '../../../export/render-preview-bridge';
import { DirectionBooklet } from '../../../export/stylize/DirectionBooklet';
import { Studio } from '../../../export/stylize/Studio';
import { STUDIO_CARD } from '../../../export/stylize/StylizeWindow';
import { DIALECTS } from '../../../../../../io/stylize/dialects';
import { DEFAULT_FOOTER, formatFooterDate } from '../../../../../../io/export/footer-template';
import { DEFAULT_OPTIONS } from '../../../export/ExportModal';
import { useShareCode } from '../../../export/use-share-code';
import { ExportJsonPanel } from '../../../export/ExportJsonModal';
import { BuildChecklist } from '../../../export/BuildChecklist';
import { PreviewFrame } from './PreviewFrame';

/** A fresh, empty map on the default template — the fallback subject for a figure that needs a
 *  real `GridState` and the visitor's own map is not yet loaded. */
function fallbackGridState(): GridState {
  return { template: DEFAULT_MAP, cells: createGrid(DEFAULT_MAP), objects: new Map(), lockedLayers: new Set() };
}

/** The map every figure below stands in for its subject: the visitor's own, or the fallback. */
function useFigureGridState(): GridState {
  const live = useEditorStore((s) => s.gridState);
  const fallback = useMemo(() => live ?? fallbackGridState(), [live]);
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
  // The window pictures the visitor's OWN map: its map band captures the live view, so the code
  // band must encode the same map or the two halves of the picture would disagree.
  const state = useEditorStore((st) => st.gridState);
  const code = useShareCode(ready, state, null, SHARE_OPTIONS.importable, SHARE_OPTIONS.resolution, SHARE_CREATED_AT);
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

/** The Save and share window itself, posed at one tab: the real head over the real panel, in the
 *  same card the live window wears, so a page's first picture is the whole window the button opens. */
function ShareWindowFigure({ section, width, height, zoom, children }: {
  section: ShareSection; width: number; height: number; zoom: number; children: React.ReactNode;
}) {
  const [tab, setTab] = useState<ShareSection>(section);
  return (
    <PreviewFrame height={Math.round(height * zoom) + 28} zoom={zoom} align="top">
      <div style={{ ...cardChrome, width, height, padding: '24px 26px 20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ShareWindowHead section={tab} onPick={setTab} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>{children}</div>
      </div>
    </PreviewFrame>
  );
}

export function ShareWindowPreview() {
  return (
    <ShareWindowFigure section="friend" width={980} height={848} zoom={0.56}>
      <ExportPanel open onDone={() => {}} />
    </ShareWindowFigure>
  );
}

/** The Import map card as it stands when the menu opens it: the real drop zone at the modal's own
 *  geometry. The no-op click keeps the modal's click-to-choose line, which the drop zone swaps for
 *  the drag-only wording when the handler is absent. */
export function ImportPreview() {
  return (
    <PreviewFrame height={310}>
      <div style={{ ...cardChrome, width: IMPORT_CARD_WIDTH, padding: IMPORT_CARD_PADDING }}>
        <ImportCardBody dragOver={false} busy={false} onClick={() => {}} />
      </div>
    </PreviewFrame>
  );
}

export function JsonPreview() {
  const [tab, setTab] = useState<ShareSection>('keep');
  return (
    <PreviewFrame width={370} height={470} zoom={0.6} align="top">
      {/* Content-sized like the live window: a posed fixed height would open a gap between the
          section rows and the footer that the real card never shows. */}
      <div style={{ ...cardChrome, width: 560, padding: '24px 26px 20px', display: 'flex', flexDirection: 'column' }}>
        <ShareWindowHead section={tab} onPick={setTab} />
        <ExportJsonPanel open onDone={() => {}} />
      </div>
    </PreviewFrame>
  );
}

function ChecklistHead() {
  const [tab, setTab] = useState<ShareSection>('game');
  return <ShareWindowHead section={tab} onPick={setTab} />;
}

export function ChecklistPreview() {
  const shown = useShownMap();
  return (
    <PreviewFrame width={372} height={456} zoom={0.6} align="top">
      <div style={{ ...cardChrome, width: 620, height: 760, padding: '24px 26px 20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
  const world = new DemoWorld();
  world.beginStroke();
  generateDesigned({
    state: world.state,
    execute: (cmd) => world.executor.execute(cmd),
    reg: world.kit.registry,
    seed: 20260830, richness: 0.9, maxElevation: 4, mode: 'mixed', region: null,
  });
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
      <div style={{ ...cardChrome, width: 620, height: 760, padding: '24px 26px 20px', overflow: 'hidden' }}>
        {subject && <BuildChecklist subject={subject} />}
      </div>
    </PreviewFrame>
  );
}

const CANDIDATE_SEEDS = [4127, 90210, 5551];

/** Each card's shot photographs that seed's OWN designed run, cached per session: three cards
 *  showing three different maps, which is the fact the candidates page teaches. */
const candidateShots = new Map<number, string>();
async function candidateShot(seed: number, aspect: number): Promise<string | null> {
  const hit = candidateShots.get(seed);
  if (hit) return hit;
  const world = new DemoWorld();
  world.beginStroke();
  generateDesigned({
    state: world.state,
    execute: (cmd) => world.executor.execute(cmd),
    reg: world.kit.registry,
    seed, richness: 0.7, maxElevation: 4, mode: 'mixed', region: null,
  });
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
interface SearchStep { query: string; captionKey: string }

/**
 * Every locale walks the same four capabilities the search sections document — a plain query,
 * an incomplete one, a cross-language one, and a multi-term AND — plus the alias beat, which
 * turns out to hold for every locale: `樱花`/`sakura` is Peach Tree's own authored alias
 * (`config/catalog/tree/tree-peach.json`) and alias fields are never keyed by locale
 * (`state/catalog.ts:indexForLocale`), so the same CJK spelling is a clean single-hit match
 * whichever interface language is reading it — mirroring `en`'s own `sakura` beat rather than
 * the interface's own tongue, which is the point being demonstrated.
 *
 * The English beat (`apple`) is kept in every non-English table too: `help.search.basic_b1`
 * quotes this exact word, in every locale's own translation, as ITS worked example of
 * cross-language matching, so this is the one query every locale's own copy already promises.
 *
 * Every query below is a verified hit through `state/catalog.ts:searchCatalog` at its own
 * locale (checked empirically, not read off the JSON — the tolerance rules turn on word-start
 * position and per-script boundaries, which is not obvious from a name string alone) — see
 * `previews-share.test.tsx`'s per-locale walk for the pinned assertion, not just this table.
 *
 * Exported for that same test: every table's every query, walked through the real `shelfItems`
 * at its own locale, must still find something.
 */
export const SEARCH_STEPS_BY_LOCALE: Record<Locale, readonly SearchStep[]> = {
  en: [
    { query: 'apple', captionKey: 'help.search.basic_t' },
    { query: 'aple', captionKey: 'help.search.typo_t' },
    { query: 'sakura', captionKey: 'help.search.alias_t' },
    { query: '红 树', captionKey: 'help.search.multiword_t' },
  ],
  zh: [
    { query: '苹果', captionKey: 'help.search.basic_t' },
    { query: '苹树', captionKey: 'help.search.typo_t' },
    { query: 'apple', captionKey: 'help.search.basic_t' },
    { query: '樱花', captionKey: 'help.search.alias_t' },
    { query: '红 树', captionKey: 'help.search.multiword_t' },
  ],
  ja: [
    { query: 'リンゴ', captionKey: 'help.search.basic_t' },
    { query: 'リンの木', captionKey: 'help.search.typo_t' },
    { query: 'apple', captionKey: 'help.search.basic_t' },
    { query: '樱花', captionKey: 'help.search.alias_t' },
    { query: 'イエロー ヒマワリ', captionKey: 'help.search.multiword_t' },
  ],
  ru: [
    { query: 'Яблоня', captionKey: 'help.search.basic_t' },
    { query: 'Яблня', captionKey: 'help.search.typo_t' },
    { query: 'apple', captionKey: 'help.search.basic_t' },
    { query: '樱花', captionKey: 'help.search.alias_t' },
    { query: 'Жёлтый подсолнух', captionKey: 'help.search.multiword_t' },
  ],
  th: [
    { query: 'ต้นแอปเปิล', captionKey: 'help.search.basic_t' },
    { query: 'ต้นแอปเปล', captionKey: 'help.search.typo_t' },
    { query: 'apple', captionKey: 'help.search.basic_t' },
    { query: '樱花', captionKey: 'help.search.alias_t' },
    { query: 'ทานตะวัน เหลือง', captionKey: 'help.search.multiword_t' },
  ],
  id: [
    { query: 'Apel', captionKey: 'help.search.basic_t' },
    { query: 'Apl', captionKey: 'help.search.typo_t' },
    { query: 'apple', captionKey: 'help.search.basic_t' },
    { query: '樱花', captionKey: 'help.search.alias_t' },
    { query: 'Matahari Kuning', captionKey: 'help.search.multiword_t' },
  ],
  fr: [
    { query: 'Pommier', captionKey: 'help.search.basic_t' },
    { query: 'Pomier', captionKey: 'help.search.typo_t' },
    { query: 'apple', captionKey: 'help.search.basic_t' },
    { query: '樱花', captionKey: 'help.search.alias_t' },
    { query: 'Tournesol jaune', captionKey: 'help.search.multiword_t' },
  ],
};

/** One typed character, and the finished query's hold with its results standing. */
const TYPE_MS = 130;
const HOLD_MS = 2400;

export function SearchPreview() {
  const locale = useEditorStore((s) => s.locale);
  const t = useT();
  const steps = useMemo<readonly SearchStep[]>(() => SEARCH_STEPS_BY_LOCALE[locale], [locale]);
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
  const locale = useEditorStore((s) => s.locale);
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
  // column's BOTTOM, where the Appearance block lives, so the rows stay in frame whatever height
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
      <div style={{ ...cardChrome, width: STUDIO_CARD.width, height: STUDIO_CARD.height, padding: STUDIO_CARD.padding, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <h2 style={{ ...windowTitle, flex: 'none', margin: 0 }}>{t('stylize.win_title')}</h2>
        {original && (
          <Studio
            dialect={DIALECTS.gemini}
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
