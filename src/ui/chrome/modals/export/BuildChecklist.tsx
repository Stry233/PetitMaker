/*
 * BuildChecklist.tsx — the third section of the save-and-share window: the materials, for someone
 * rebuilding this map by hand in the game.
 *
 * It renders `state/build-checklist.ts` and derives nothing of its own, so what a reader counts
 * here is what the object index and the map stats hold. Item names come from each catalog item's
 * own `name` map, which is why adding an item to the catalog adds it to this list with no key.
 *
 * SUPPLY SHELVES: each category is a FULL-WIDTH card, so its height is its own content and never
 * coupled to a neighbour's — a two-column masonry layout ties two cards' heights together the
 * moment they differ, which is what a shorter Facility card sitting beside a long Flora one would
 * do. Item rows flow in a CSS grid inside the card instead, so a long list wraps into columns
 * rather than growing the card ever taller. No collapse: every item stays visible, since a reader
 * rebuilding by hand cannot act on "+N more kinds".
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { iconUrl } from '../../../../assets/icon-urls';
import { localizedName, useT } from '../../../../i18n/context';
import {
  buildChecklist, buildChecklistText, CATEGORY_LABEL,
  type BuildChecklist as BuildChecklistData, type ChecklistGroup, type ChecklistItem, type ChecklistLayer,
} from '../../../../state/build-checklist';
import { subscribeMapStats } from '../../../../state/map-stats';
import { useEditorStore } from '../../../../state/store';
import { btnReset, buttonMotion, exitTransition, radii, shadows, springs } from '../../../design/styles';
import { skin } from '../../../design/window-skin';

const sectionTitle: CSSProperties = { fontSize: 15, fontWeight: 900, color: skin.ink };
const noteText: CSSProperties = { fontSize: 12, fontWeight: 600, color: skin.plateInk, opacity: 0.8, lineHeight: 1.45 };
const totalChip: CSSProperties = { fontSize: 12, fontWeight: 800, color: skin.plateInk, fontVariantNumeric: 'tabular-nums' };

/** The supply crate itself: an inset plate (the same fill today's rows already stand on), heavy
 *  header, everything else inside. */
const card: CSSProperties = {
  background: skin.inset, borderRadius: radii.md, padding: '10px 14px 12px',
  display: 'flex', flexDirection: 'column', gap: 8,
};
const cardHeaderRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 };
/** Small-caps-style: uppercase + tracked out + the heaviest weight on the card, so a header reads
 *  as ranking well above its own rows even at a similar font size. */
const cardHeaderLabel: CSSProperties = {
  fontSize: 12.5, fontWeight: 900, color: skin.ink, textTransform: 'uppercase', letterSpacing: '0.06em',
};
const cardHeaderChip: CSSProperties = {
  fontSize: 11.5, fontWeight: 800, color: skin.onDark, background: skin.ink, borderRadius: radii.pill,
  padding: '2px 9px', fontVariantNumeric: 'tabular-nums', flex: 'none',
};

/** Auto-fill columns ~220px wide: two at the window's ~560px content width, one on a narrower
 *  screen, three-plus on a wider one — the layout that resolves the masonry worry, since every
 *  card's own row count decides its own height. */
const itemsGrid: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', columnGap: 18, rowGap: 6,
};
const itemRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 };
const iconSlot: CSSProperties = { width: 20, height: 20, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const iconImg: CSSProperties = { width: 18, height: 18, objectFit: 'contain', pointerEvents: 'none' };
const colorSwatch: CSSProperties = { width: 14, height: 14, borderRadius: radii.sm, border: `1px solid ${skin.line}` };
const itemName: CSSProperties = {
  fontSize: 13.5, fontWeight: 700, color: skin.ink, minWidth: 0, overflow: 'hidden',
  textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto',
};
const itemCount: CSSProperties = { fontSize: 13, fontWeight: 800, color: skin.ink, fontVariantNumeric: 'tabular-nums', flex: 'none' };

const chipsRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
/** A layer chip steps back up to `skin.plate`, the cream one level lighter than the card's own
 *  `skin.inset` — the alternation `window-skin.ts` describes, so a chip reads as its own token
 *  sitting IN the crate rather than another row of it. */
const layerChip: CSSProperties = {
  background: skin.plate, borderRadius: radii.pill, padding: '5px 12px', fontSize: 12.5, fontWeight: 700,
  color: skin.ink, display: 'flex', alignItems: 'baseline', gap: 6,
};
const layerChipCount: CSSProperties = { fontWeight: 900, fontVariantNumeric: 'tabular-nums' };

function ItemIcon({ icon, color }: { icon?: string; color?: string }) {
  const url = icon ? iconUrl(icon) : undefined;
  return (
    <span style={iconSlot}>
      {url ? (
        <img src={url} alt="" draggable={false} style={iconImg} />
      ) : color ? (
        <span style={{ ...colorSwatch, background: color }} />
      ) : null}
    </span>
  );
}

function ItemRow({ item, countText }: { item: ChecklistItem; countText: string }) {
  const locale = useEditorStore((s) => s.locale);
  return (
    <div style={itemRowStyle} data-testid={`checklist-item-${item.catalogId}`}>
      <ItemIcon icon={item.icon} color={item.color} />
      <span style={itemName}>{localizedName(item.name, locale)}</span>
      <span style={itemCount}>{countText}</span>
    </div>
  );
}

function CategoryCard({ group }: { group: ChecklistGroup }) {
  const t = useT();
  return (
    <div style={card} data-testid={`checklist-card-${group.category}`}>
      <div style={cardHeaderRow}>
        <span style={cardHeaderLabel}>{t(CATEGORY_LABEL[group.category] ?? group.category)}</span>
        <span style={cardHeaderChip}>{group.total}</span>
      </div>
      <div style={itemsGrid}>
        {group.items.map((item) => (
          <ItemRow key={item.catalogId} item={item} countText={`x${item.count}`} />
        ))}
      </div>
    </div>
  );
}

function RoadsCard({ roads, roadTotal }: { roads: ChecklistItem[]; roadTotal: number }) {
  const t = useT();
  return (
    <div style={card} data-testid="checklist-card-roads">
      <div style={cardHeaderRow}>
        <span style={cardHeaderLabel}>{t('checklist.sec_roads')}</span>
        <span style={cardHeaderChip}>{t('checklist.cells', { n: roadTotal })}</span>
      </div>
      <div style={itemsGrid}>
        {roads.map((item) => (
          <ItemRow key={item.catalogId} item={item} countText={t('checklist.cells', { n: item.count })} />
        ))}
      </div>
    </div>
  );
}

/** Terrain reads as one compact card of per-layer chips: a map's layer count can run to 8, and a
 *  chip carries a layer's numbers in a fraction of a row's room. */
function TerrainCard({ layers }: { layers: ChecklistLayer[] }) {
  const t = useT();
  return (
    <div style={card} data-testid="checklist-card-terrain">
      <div style={cardHeaderRow}>
        <span style={cardHeaderLabel}>{t('checklist.sec_terrain')}</span>
      </div>
      <div style={chipsRow}>
        {layers.map((layer) => {
          const label = layer.layer === 0 ? t('export.layer_ground') : t('export.layer_level', { n: layer.layer });
          return (
            <span key={layer.layer} style={layerChip}>
              <span>{label}</span>
              {layer.blocks > 0 && <span style={layerChipCount}>{t('checklist.cells', { n: layer.blocks })}</span>}
              {layer.water > 0 && <span style={layerChipCount}>{t('checklist.water_part', { n: layer.water })}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// Lifted above its siblings: a positioned element paints over later non-positioned content
// regardless of DOM order, so without the raise the bubble slid UNDER the next shelf's count chip.
const copyButtonWrap: CSSProperties = { position: 'relative', display: 'inline-block', flex: 'none', zIndex: 1 };
const copyButton: CSSProperties = {
  ...btnReset,
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: skin.inset, color: skin.ink, fontWeight: 800, fontSize: 12.5, borderRadius: radii.pill,
  padding: '7px 14px',
};
/** The "Copied" confirmation, styled exactly like About's own build-info bubble (same plate + ink
 *  + hairline + float shadow) — mirrored locally rather than shared, since About's version lives
 *  beside a plain text row and this one beside a filled pill, and the position flips (this bubble
 *  drops BELOW the button, About's rises above its row). */
const copiedBubble: CSSProperties = {
  position: 'absolute', left: '50%', top: '100%', marginTop: 8,
  background: skin.plate, color: skin.ink, border: `1px solid ${skin.line}`, borderRadius: radii.md,
  padding: '5px 11px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', boxShadow: shadows.float,
  pointerEvents: 'none',
};
const copiedBubbleTail: CSSProperties = {
  position: 'absolute', left: '50%', top: -5, marginLeft: -5, width: 10, height: 10,
  background: skin.plate, border: `1px solid ${skin.line}`, borderBottom: 'none', borderRight: 'none',
  transform: 'rotate(45deg)',
};

function CopyChecklistButton({ list }: { list: BuildChecklistData }) {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const [copied, setCopied] = useState(false);
  // Same "restart the window on a fast re-click" discipline as About's copy-build-info timer.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildChecklistText(list, locale, t));
    } catch {
      // Clipboard API unavailable/denied (e.g. insecure context) — silent no-op.
      return;
    }
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div style={copyButtonWrap}>
      <motion.button
        type="button"
        {...buttonMotion}
        style={copyButton}
        onClick={copy}
        data-testid="checklist-copy-button"
      >
        {t('checklist.copy')}
      </motion.button>
      <AnimatePresence>
        {copied && (
          <motion.div
            key="checklist-copied-bubble"
            role="status"
            aria-live="polite"
            style={copiedBubble}
            initial={{ opacity: 0, y: -6, scale: 0.9, x: '-50%' }}
            animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
            exit={{ opacity: 0, y: -6, scale: 0.9, x: '-50%', transition: exitTransition }}
            transition={springs.stiff}
          >
            {t('about.copied')}
            <span style={copiedBubbleTail} aria-hidden />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function BuildChecklist() {
  const t = useT();
  const gridState = useEditorStore((s) => s.gridState);
  const eventBus = useEditorStore((s) => s.eventBus);
  // The grid mutates in place, so no store publication follows an edit: the map-changed tick is
  // what tells this list to read again. It is the shared rAF-coalesced one, which keeps a generate
  // (thousands of objects) to a single recount per frame. Both derivations underneath are memoized
  // per GridState, so a recount that follows nothing is a cache read.
  const [, recount] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () => subscribeMapStats(eventBus, () => useEditorStore.getState().gridState, recount),
    [eventBus],
  );
  const list = gridState ? buildChecklist(gridState) : null;

  if (!list) return null;

  const groupsWithItems = list.groups.filter((g) => g.items.length > 0);
  const placedTotal = list.groups.reduce((n, g) => n + g.total, 0);
  const nothing = groupsWithItems.length === 0 && list.roads.length === 0 && list.layers.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <CopyChecklistButton list={list} />
      </div>

      {nothing && <div style={{ ...noteText, opacity: 1 }}>{t('checklist.empty')}</div>}

      {groupsWithItems.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span style={sectionTitle}>{t('checklist.sec_objects')}</span>
            <span style={totalChip}>{t('checklist.total', { n: placedTotal })}</span>
          </div>
          {groupsWithItems.map((group) => (
            <CategoryCard key={group.category} group={group} />
          ))}
        </section>
      )}

      {list.roads.length > 0 && <RoadsCard roads={list.roads} roadTotal={list.roadTotal} />}
      {list.layers.length > 0 && <TerrainCard layers={list.layers} />}

      {list.unresolved > 0 && <div style={noteText}>{t('checklist.unknown', { n: list.unresolved })}</div>}
    </div>
  );
}
