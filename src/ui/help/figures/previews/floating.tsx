/*
 * The figures for the right-click menu and the delete confirmation: each surface's own face
 * (`ContextMenuFace`, `DeleteConfirmFace`) over the rows and question the live surface composes.
 */
import type { CSSProperties } from 'react';
import { PreviewFrame } from './PreviewFrame';
import {
  ContextMenuFace, MenuHeader, objectMenuRows, terrainMenuRows,
} from '../../../chrome/floating/ContextMenu';
import { useTouchMode } from '../../../design/input-mode';
import { DeleteConfirmFace, objectDeleteTitle } from '../../../chrome/floating/DeletePopover';
import { getCatalogItem } from '../../../../state/catalog';
import { localizedName, useLocale, useT } from '../../../../i18n/context';

const noop = () => {};

/** The piece both figures are about: a cabin, which turns, so the menu shows its whole facing row. */
const PIECE = 'building-forest-cabin';

/** The facing the pictured piece stands at, so the tick is on a row rather than on the first one. */
const STANDING_AT = 90;

/** The delete card stands in the figure's flow rather than at a screen position of its own, and the
 *  frame takes its own width, so a narrow column shrinks the figure whole rather than squeezing the
 *  card; the menu, a floating menu, pictures itself in the flow. */
const IN_FLOW: CSSProperties = { position: 'relative' };

/** The menu on a piece that turns, beside the menu on terrain: the same card, the rows each target
 *  actually offers. */
export function ContextMenuPreview() {
  const t = useT();
  const locale = useLocale();
  const touch = useTouchMode();
  const item = getCatalogItem(PIECE);
  // By finger the object's long-press menu, headed by its name; with a mouse its right-click menu
  // beside the terrain's.
  if (touch) {
    return (
      <PreviewFrame height={320} fit width="max-content">
        <ContextMenuFace
          rows={objectMenuRows(t, STANDING_AT, !!item?.rotatable, { pickable: true, movable: true })}
          header={<MenuHeader item={item} name={item ? localizedName(item.name, locale) : PIECE} />}
          touch
          onPick={noop}
        />
      </PreviewFrame>
    );
  }
  return (
    <PreviewFrame height={240} fit width="max-content">
      <div style={{ display: 'flex', gap: 34, alignItems: 'flex-start' }}>
        <ContextMenuFace rows={objectMenuRows(t, STANDING_AT, !!item?.rotatable)} onPick={noop} />
        <ContextMenuFace rows={terrainMenuRows(t, false)} onPick={noop} />
      </div>
    </PreviewFrame>
  );
}

/** The card a single removal opens, naming the piece it is about. */
export function DeleteConfirmPreview() {
  const t = useT();
  const locale = useLocale();
  const item = getCatalogItem(PIECE);
  return (
    <PreviewFrame height={240} fit width="max-content">
      <DeleteConfirmFace
        title={objectDeleteTitle(t, item ? localizedName(item.name, locale) : PIECE)}
        onCancel={noop}
        onConfirm={noop}
        style={IN_FLOW}
      />
    </PreviewFrame>
  );
}
