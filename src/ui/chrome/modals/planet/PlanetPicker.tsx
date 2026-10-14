/**
 * The Change Planet window's list: the current planet when neither list holds it, the built-in planets, then My planets with its New planet and
 * Import planet rows ahead of the saved ones. The planet the map stands on carries a dot.
 */
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { type MapTemplate } from '../../../../core/model/types';
import { type Locale } from '../../../../core/model/locale';
import { MAP_LIST } from '../../../../config/maps';
import { isCustomTemplate } from '../../../../core/model/planet';
import { iconUrl } from '../../../../assets/icon-urls';
import { useT } from '../../../../i18n/context';
import type { PlanetEntry } from '../../../../io/storage/planet-library';
import { shownPlanetName } from '../../../../editor/session/planet-names';
import { ActionButton } from '../../../primitives/ActionButton';
import { ImportFileIcon, PlusIcon } from '../../../primitives/line-glyphs';
import { paintPlanet } from '../../../../view/map2d/capture/planet-painter';
import { ScrollArea } from '../../../primitives/ScrollArea';
import { CONTROL_CLEARANCE } from '../../../primitives/use-scroll-row';
import { cssMotion } from '../../../design/motion';
import { font, radii, shadows } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { skin } from '../../../design/window-skin';
import { SEA } from '../../../design/tokens';

/** One planet the window can choose: a built-in by its template id, a saved one by its entry id, and an
 *  unsaved current planet by its template id with no entry. */
export interface PlanetChoice { key: string; name: string; template: MapTemplate; entry: PlanetEntry | null }

export function planetChoices(entries: readonly PlanetEntry[], locale: Locale): { builtin: PlanetChoice[]; mine: PlanetChoice[] } {
  return {
    builtin: MAP_LIST.map((template) => ({ key: template.id, name: shownPlanetName(template, locale), template, entry: null })),
    mine: entries.map((entry) => ({ key: entry.entryId, name: entry.name, template: entry.template, entry })),
  };
}

const ART = 44;

const listStyle: CSSProperties = { width: 250, flex: 'none', height: '100%' };
const groupStyle: CSSProperties = { ...roleFont('subhead'), color: skin.muted, fontFamily: font.family, marginTop: 12, marginInline: 12, marginBottom: 4 };
const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 56, padding: '6px 10px',
  border: 'none', borderRadius: radii.lg, textAlign: 'start', color: skin.ink, fontFamily: font.family,
  WebkitTapHighlightColor: 'transparent', transition: cssMotion('planet.choice.select', ['background-color']),
};
const nameStyle: CSSProperties = { flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const hereDot: CSSProperties = { width: 10, height: 10, borderRadius: '50%', background: skin.ink, flex: 'none', marginInlineEnd: 4 };
const artStyle: CSSProperties = { width: ART, height: ART, flex: 'none', display: 'block' };
const actionArt: CSSProperties = { ...artStyle, borderRadius: '50%', background: skin.inset, display: 'grid', placeItems: 'center', color: skin.ink };

/** The thumbnail's margin as a share of its size: a square fitted this far in keeps its corners
 *  inside the disc, since (1 - 1/sqrt 2) / 2 is about 0.146. */
const THUMB_MARGIN = 0.15;

/** A saved planet's round thumbnail, drawn by the same painter as the preview. */
function PlanetThumb({ template, size = ART }: { template: MapTemplate; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (ref.current) paintPlanet(ref.current, { template }, { tx: 0, ty: 0, scale: 1 }, { margin: size * THUMB_MARGIN });
  }, [template, size]);
  return (
    <canvas ref={ref} aria-hidden style={{
      ...artStyle, width: size, height: size, borderRadius: '50%', background: SEA,
      boxShadow: `inset 0 0 0 1.5px ${skin.line}`, filter: shadows.thumbDrop,
    }} />
  );
}

function Row({ testId, chosen, disabled, art, name, here, onClick }: {
  testId: string; chosen?: boolean; disabled?: boolean; art: ReactNode; name: string; here?: boolean; onClick: () => void;
}) {
  const t = useT();
  return (
    <ActionButton interaction="row" data-testid={testId} aria-pressed={chosen === undefined ? undefined : chosen}
      aria-current={here ? 'true' : undefined} disabled={disabled} onClick={onClick}
      style={{ ...rowStyle, background: chosen ? skin.active : 'transparent' }}>
      {art}
      <span style={{ ...nameStyle, ...roleFont(chosen ? 'menu' : 'label') }}>{name}</span>
      {here && <span data-testid="planet-current" role="img" aria-label={t('planet.current')} title={t('planet.current')} style={hereDot} />}
    </ActionButton>
  );
}

interface PlanetPickerProps {
  /** The planet the map stands on when neither the built-ins nor My planets hold it. */
  current?: PlanetChoice | undefined;
  builtin: readonly PlanetChoice[];
  mine: readonly PlanetChoice[];
  chosenKey: string | null;
  /** Template id of the planet the map stands on. */
  currentId: string | undefined;
  onChoose: (key: string) => void;
  onNew: () => void;
  newDisabled: boolean;
  /** Absent where the edition reads no planet files. */
  onImport?: () => void;
}

export function PlanetPicker({ current, builtin, mine, chosenKey, currentId, onChoose, onNew, newDisabled, onImport }: PlanetPickerProps) {
  const t = useT();
  const choice = (c: PlanetChoice) => (
    <Row key={c.key} testId={`planet-${c.key}`} chosen={c.key === chosenKey} here={c.template.id === currentId} name={c.name}
      art={isCustomTemplate(c.template) ? <PlanetThumb template={c.template} />
        : <img src={iconUrl(`planet-${c.key}`)} alt="" draggable={false} style={{ ...artStyle, objectFit: 'contain' }} />}
      onClick={() => onChoose(c.key)} />
  );
  return (
    <ScrollArea gutter="stable" fade="both" style={listStyle}
      contentStyle={{ display: 'flex', flexDirection: 'column', gap: 4, padding: CONTROL_CLEARANCE }}>
      {current && (
        <>
          <div style={{ ...groupStyle, marginTop: 2 }}>{t('planet.current_group')}</div>
          {choice(current)}
        </>
      )}
      <div style={current ? groupStyle : { ...groupStyle, marginTop: 2 }}>{t('planet.builtin_group')}</div>
      {builtin.map(choice)}
      <div style={groupStyle}>{t('planet.mine_group')}</div>
      <Row testId="planet-new" name={t('planet.new')} disabled={newDisabled} onClick={onNew}
        art={<span style={actionArt}><PlusIcon /></span>} />
      {onImport && (
        <Row testId="planet-import" name={t('planet.import')} onClick={onImport}
          art={<span style={actionArt}><ImportFileIcon /></span>} />
      )}
      {mine.map(choice)}
    </ScrollArea>
  );
}
