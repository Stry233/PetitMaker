/*
 * The save-and-share window's build checklist: `state/build-checklist.ts` rendered as one full-width
 * card per category (item rows wrap into columns inside it), every item visible, names from each
 * catalog item's own `name` map.
 */
import { Pill } from '../../../primitives/Pill';
import type { CSSProperties } from 'react';
import { iconUrl } from '../../../../assets/icon-urls';
import { localizedName, useLocale, useT } from '../../../../i18n/context';
import {
  buildChecklist, buildChecklistText, CATEGORY_LABEL,
  type BuildChecklist as BuildChecklistData, type ChecklistGroup, type ChecklistItem, type ChecklistLayer,
} from '../../../../state/build-checklist';
import type { GridState } from '../../../../core/model/types';
import { useEditorStore } from '../../../../state/store';
import { radii} from '../../../design/styles';
import { skin, windowChip } from '../../../design/window-skin';
import { roleFont, roleWeight } from '../../../design/text-weight';
import { useMapRevision } from '../../../session/use-map-revision';
import { CopiedBubble, useCopyFeedback } from '../../../primitives/CopiedBubble';

const sectionTitle: CSSProperties = { ...roleFont('head'), color: skin.ink };
const noteText: CSSProperties = { ...roleFont('caption'), color: skin.plateInk, opacity: 0.8, lineHeight: 1.45 };
const totalChip: CSSProperties = { ...roleFont('small'), color: skin.plateInk, fontVariantNumeric: 'tabular-nums' };

/** The supply crate itself: an inset plate (the same fill the rows stand on), heavy
 *  header, everything else inside. */
const card: CSSProperties = {
  background: skin.inset, borderRadius: radii.md, padding: '10px 14px 12px',
  display: 'flex', flexDirection: 'column', gap: 8,
};
const cardHeaderRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 };
/** Sentence case like every other window heading; `subhead` is the rung whose heaviest weight ranks
 *  a header above its own rows at a similar font size. */
const cardHeaderLabel: CSSProperties = {
  ...roleFont('subhead'), color: skin.ink,
};
const cardHeaderChip: CSSProperties = {
  ...roleFont('small'), color: skin.onDark, background: skin.ink, borderRadius: radii.pill,
  padding: '2px 8px', fontVariantNumeric: 'tabular-nums', flex: 'none',
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
  ...roleFont('label'), color: skin.ink, minWidth: 0, overflow: 'hidden',
  textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto',
};
const itemCount: CSSProperties = { ...roleFont('chip'), color: skin.ink, fontVariantNumeric: 'tabular-nums', flex: 'none' };

const chipsRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
/** A layer chip steps back up to `skin.plate`, the cream one level lighter than the card's own
 *  `skin.inset` — the alternation `window-skin.ts` describes, so a chip reads as its own token
 *  sitting in the crate rather than another row of it. */
const layerChip: CSSProperties = { ...windowChip('inset'), display: 'flex', alignItems: 'baseline', gap: 6 };
// The figure outranks the layer name it sits beside inside the chip. `subhead` is the 13px Heavy
// answer, borrowed for its weight alone, so the count adapts with the rest of the window.
const layerChipCount: CSSProperties = { fontWeight: roleWeight('subhead'), fontVariantNumeric: 'tabular-nums' };

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

/** One row of the checklist: icon, name, count. What a shelf card lists and what the Help
 *  Center's built-pieces figure stands are the same row, drawn once. */
export function ChecklistItemRow({ icon, color, name, countText, testId }: {
  icon?: string; color?: string; name: string; countText: string; testId?: string;
}) {
  return (
    <div style={itemRowStyle} data-testid={testId}>
      <ItemIcon icon={icon} color={color} />
      <span style={itemName}>{name}</span>
      <span style={itemCount}>{countText}</span>
    </div>
  );
}

function ItemRow({ item, countText }: { item: ChecklistItem; countText: string }) {
  const locale = useLocale();
  return (
    <ChecklistItemRow
      icon={item.icon} color={item.color} name={localizedName(item.name, locale)}
      countText={countText} testId={`checklist-item-${item.catalogId}`}
    />
  );
}

function CountedCard({ id, label, items, total }: { id: string; label: string; items: ChecklistItem[]; total: number }) {
  return (
    <div style={card} data-testid={`checklist-card-${id}`}>
      <div style={cardHeaderRow}>
        <span style={cardHeaderLabel}>{label}</span>
        <span style={cardHeaderChip}>{total}</span>
      </div>
      <div style={itemsGrid}>
        {items.map((item) => (
          <ItemRow key={item.catalogId} item={item} countText={`x${item.count}`} />
        ))}
      </div>
    </div>
  );
}

function CategoryCard({ group }: { group: ChecklistGroup }) {
  const t = useT();
  const label = CATEGORY_LABEL[group.category] ? t(CATEGORY_LABEL[group.category]!) : group.category;
  return <CountedCard id={group.category} label={label} items={group.items} total={group.total} />;
}

function RoadsCard({ roads, roadTotal }: { roads: ChecklistItem[]; roadTotal: number }) {
  const t = useT();
  return (
    <div style={card} data-testid="checklist-card-roads">
      <div style={cardHeaderRow}>
        <span style={cardHeaderLabel}>{t('checklist.sec_roads')}</span>
        <span style={cardHeaderChip}>{t('units.cells', { n: roadTotal })}</span>
      </div>
      <div style={itemsGrid}>
        {roads.map((item) => (
          <ItemRow key={item.catalogId} item={item} countText={t('units.cells', { n: item.count })} />
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
              {layer.blocks > 0 && <span style={layerChipCount}>{t('units.cells', { n: layer.blocks })}</span>}
              {layer.water > 0 && <span style={layerChipCount}>{t('checklist.water_part', { n: layer.water })}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// Lifted above its siblings: a positioned element paints over later non-positioned content
// regardless of DOM order, so without the raise the bubble paints under the next shelf's count chip.
const copyButtonWrap: CSSProperties = { position: 'relative', display: 'inline-block', flex: 'none', zIndex: 1 };
const copyButton: CSSProperties = { color: skin.ink };
function CopyChecklistButton({ list }: { list: BuildChecklistData }) {
  const t = useT();
  const locale = useLocale();
  const { copied, copy: copyText } = useCopyFeedback();
  const copy = () => copyText(buildChecklistText(list, locale, t));

  return (
    <div style={copyButtonWrap}>
      <Pill style={copyButton} onClick={copy} data-testid="checklist-copy-button">{t('checklist.copy')}</Pill>
      <CopiedBubble show={copied !== null} side="below">{t('about.copied')}</CopiedBubble>
    </div>
  );
}

export function BuildChecklist({ subject }: { subject?: GridState } = {}) {
  const t = useT();
  const liveState = useEditorStore((s) => s.gridState);
  // A `subject` is a still a Help figure hands over, which nothing edits. The live grid mutates in
  // place, so the frame-timed map revision is what tells the list to read again: a generate
  // (thousands of objects) recounts once per frame, and both derivations are memoized per GridState.
  useMapRevision(!subject, 'frame');
  const gridState = subject ?? liveState;
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

      {list.landmarks.length > 0 && (
        <CountedCard id="landmarks" label={t('checklist.sec_landmarks')} items={list.landmarks} total={list.landmarkTotal} />
      )}

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
