/*
 * floating.tsx — the Help Center's figures for the two surfaces the MAP raises: the right-click
 * menu and the delete confirmation.
 *
 * Both are store-driven in the app (the menu reads which block was clicked, the card which block is
 * being removed) and both position themselves against the live projection, so what the figures mount
 * is each surface's own face — `ContextMenuFace` over the rows the menu itself builds, and
 * `DeleteConfirmFace` over the question the popover itself composes. The rows and the sentence are
 * therefore the shipped ones, read for a real catalog item at a real facing.
 */
import type { CSSProperties } from 'react';
import { PreviewFrame } from './PreviewFrame';
import {
  ContextMenuFace, objectMenuRows, terrainMenuRows,
} from '../../../../floating/ContextMenu';
import { DeleteConfirmFace, objectDeleteTitle } from '../../../../floating/DeletePopover';
import { getCatalogItem } from '../../../../../../state/catalog';
import { useEditorStore } from '../../../../../../state/store';
import { localizedName, useT } from '../../../../../../i18n/context';

const noop = () => {};

/** The piece both figures are about: a cabin, which turns, so the menu shows its whole facing row. */
const PIECE = 'building-forest-cabin';

/** The facing the pictured piece stands at, so the tick is on a row rather than on the first one. */
const STANDING_AT = 90;

/** Both cards stand in the figure's flow rather than at a screen position of their own. */
const IN_FLOW: CSSProperties = { position: 'relative' };

/** The menu on a piece that turns, beside the menu on terrain: the same card, the rows each target
 *  actually offers. */
export function ContextMenuPreview() {
  const t = useT();
  const item = getCatalogItem(PIECE);
  return (
    <PreviewFrame height={240}>
      <div style={{ display: 'flex', gap: 34, alignItems: 'flex-start' }}>
        <ContextMenuFace
          rows={objectMenuRows(t, STANDING_AT, !!item?.rotatable)}
          onPick={noop}
          style={IN_FLOW}
        />
        <ContextMenuFace rows={terrainMenuRows(t, false)} onPick={noop} style={IN_FLOW} />
      </div>
    </PreviewFrame>
  );
}

/** The card a single removal opens, naming the piece it is about. */
export function DeleteConfirmPreview() {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const item = getCatalogItem(PIECE);
  return (
    <PreviewFrame height={165}>
      <DeleteConfirmFace
        title={objectDeleteTitle(t, item ? localizedName(item.name, locale) : PIECE)}
        onCancel={noop}
        onConfirm={noop}
        style={IN_FLOW}
      />
    </PreviewFrame>
  );
}
