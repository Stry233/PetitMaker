/** The strip's one row of cards, wide and upright: New blueprint first, then the library's cards with
 *  the slot a carry opens, the armed card standing over its neighbours, whose glide its row's owner
 *  keeps (`use-blueprint-carry.ts:useReorderGlide`). */
import type { CSSProperties } from 'react';
import { zCards } from '../../../design/styles';
import { tourTargetAttr } from '../../../chrome/tour/steps';
import { MorphOnChange } from '../../../primitives/MorphOnChange';
import type { MorphFirst } from '../../../primitives/morph';
import { BlueprintCard, NewBlueprintCard } from './BlueprintCard';
import { useAsks } from './blueprint-asks';
import { usePieces, type BlueprintShelfModel } from './use-blueprint-shelf';
import { BLUEPRINT_SLOT_ATTR, cardPiece, withSlot, type useReorderGlide } from './use-blueprint-carry';

export function StripCards({ model, glide, cardW }: {
  model: BlueprintShelfModel; glide: ReturnType<typeof useReorderGlide>; cardW: number;
}) {
  const piece = usePieces();
  const asks = useAsks();
  const slot: CSSProperties = { flex: 'none', width: cardW, position: 'relative' };
  return (
    <MorphOnChange<MorphFirst> {...glide}>
      <div {...piece('new-card')} {...tourTargetAttr('blueprint-new')} style={slot}><NewBlueprintCard onPress={model.newBlueprint} /></div>
      {withSlot(model.carry.slot, 'row', model.records.map((r) => (
        // The armed card's plate bleeds into its neighbours, so it stands above them.
        <div key={r.id} {...piece(cardPiece(r.id))} {...{ [BLUEPRINT_SLOT_ATTR]: r.id }} {...tourTargetAttr('blueprint-card')}
          style={{ ...slot, zIndex: model.armed?.id === r.id ? zCards.chosen : 0 }}>
          <BlueprintCard record={r} lifted={model.lifted} chosen={model.armed?.id === r.id} onPress={() => model.toggle(r.id)}
            carry={{ lift: model.carry.lift, pan: 'x' }} onRename={(anchor) => asks.rename(r.id, anchor)}
            onMenu={(anchor) => asks.itemsMenu([r.id], anchor)} />
        </div>
      )), <div style={slot} />)}
    </MorphOnChange>
  );
}
