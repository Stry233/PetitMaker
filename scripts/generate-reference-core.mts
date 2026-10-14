import ts from 'typescript';
import * as constants from '../src/view/shared/viewport/view-constants';
import * as world2d from '../src/view/map2d/geometry/world';
import * as profile from '../src/core/game/profile';
import * as palette from '../src/core/model/palette';
import { createDefaultRegistry } from '../src/rules';
import { CORE_FOLDERS, LAYERS, LAYER_DOCS, LEAF_RANKS, type Layer } from './layers.mts';

type ReadSource = (path: string) => string;

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

function declarations(read: ReadSource, path: string, names: readonly string[]): string {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  const selected = names.map((name) => {
    const matches = source.statements.filter((node) => {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return node.name.text === name;
      return ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => d.name.getText(source) === name);
    });
    if (matches.length !== 1) throw new Error(`${path}: expected one declaration of ${name}`);
    return printer.printNode(ts.EmitHint.Unspecified, matches[0]!, source).trim();
  });
  return `Source: [${path}](../${path}).\n\n\`\`\`ts\n${selected.join('\n\n')}\n\`\`\``;
}

/** Words of `text` in lines of at most `width` characters. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(' ')) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last]!.length + 1 + word.length <= width) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}

const code = (name: string): string => `\`${name}\``;

/** The layers a layer may import besides itself: every lower rank, and the others of its group. */
function mayImport(rank: number, layer: Layer): string {
  const lower = LAYERS.slice(0, rank).flat();
  const peers = LAYERS[rank]!.filter((other) => other !== layer);
  if (lower.length === 0) return 'only itself';
  const below = lower.length <= 2 ? lower.map(code).join(', ') : `${code(lower[0]!)} through ${code(lower[lower.length - 1]!)}`;
  return peers.length === 0 ? below : `${below}, and ${peers.map(code).join(', ')} beside it`;
}

/** The stack diagram, top layer first, and the layer table in `LAYERS` order. */
function layerReference(): string {
  const inner = 72;
  const label = 12;
  const rule = (left: string, right: string): string => `${left}${'─'.repeat(inner)}${right}`;
  const row = (text: string): string => `│${text.padEnd(inner)}│`;
  const box = (name: string, text: string): string[] =>
    wrap(text, inner - label - 1).map((line, i) => row(` ${(i === 0 ? name : '').padEnd(label - 1)}${line}`));
  const ranks = LAYERS.map((group, rank) => ({ group, rank })).reverse();
  const boxes = ranks.map(({ group }) => {
    const lines = group.flatMap((layer) => box(layer === 'entry' ? 'entry' : `${layer}/`, LAYER_DOCS[layer].summary));
    if (group[0] === 'core') lines.push(...box('', `folders, bottom to top: ${CORE_FOLDERS.map((f) => f.join(' · ')).join(' < ')}`));
    return lines;
  });
  const diagram = [
    rule('┌', '┐'),
    ...boxes.flatMap((lines, i) => (i === 0 ? lines : [rule('├', '┤'), ...lines])),
    rule('└', '┘'),
    `${' '.repeat(23)}imports only ever point DOWN  ↓`,
  ];
  const table = [
    '| Layer | Owns | May import |', '|---|---|---|',
    ...LAYERS.flatMap((group, rank) => group.map((layer) =>
      `| ${layer === 'entry' ? 'entry' : code(`${layer}/`)} | ${LAYER_DOCS[layer].owns} | ${mayImport(rank, layer)} |`)),
  ];
  return [
    'Source: [scripts/layers.mts](../scripts/layers.mts), `LAYERS`, `CORE_FOLDERS`, `LEAF_RANKS` and `LAYER_DOCS`.', '',
    '```', ...diagram, '```', '',
    ...table, '',
    `Ranked with a lower layer than their folder: ${Object.entries(LEAF_RANKS).map(([path, layer]) => `${code(path)} with ${code(layer)}`).join(', ')}.`,
  ].join('\n');
}

export function referenceBlocks(read: ReadSource): Record<string, string> {
  const scalars = (module: Record<string, unknown>) => Object.entries(module).filter(([, value]) => typeof value !== 'object' && typeof value !== 'function');
  const table = (rows: [string, unknown][]) => [
    '| Constant | Value |', '|---|---|',
    ...rows.map(([name, value]) => `| \`${name}\` | \`${JSON.stringify(value)}\` |`),
  ];
  const rules = createDefaultRegistry().getRules();
  return {
    layers: layerReference(),
    constants: [
      'Game facts. Source: [src/core/game/profile.ts](../src/core/game/profile.ts).', '',
      ...table(scalars(profile)), '',
      'Game colours. Source: [src/core/model/palette.ts](../src/core/model/palette.ts).', '',
      ...table(scalars(palette)), '',
      'Editor constants. Source: [src/view/shared/viewport/view-constants.ts](../src/view/shared/viewport/view-constants.ts).', '',
      ...table(scalars(constants)), '',
      '2D view units and camera bounds. Source: [src/view/map2d/geometry/world.ts](../src/view/map2d/geometry/world.ts).', '',
      ...table(scalars(world2d)),
    ].join('\n'),
    rules: [
      'Source: [src/rules/index.ts](../src/rules/index.ts), through `createDefaultRegistry().getRules()`.', '',
      '| Order | Rule | Phase |', '|---|---|---|',
      ...rules.map((rule, index) => `| ${index + 1} | \`${rule.id}\` | ${rule.phase} |`),
    ].join('\n'),
    tool: declarations(read, 'src/tools/pointer/runtime/types.ts', ['Tool']),
    save: declarations(read, 'src/io/save/format/types.ts', ['CURRENT_VERSION', 'SaveObject', 'PersistedCamera', 'SaveFile']),
  };
}

/** Only marked regions are owned by the generator; missing or repeated markers refuse the write. */
export function rewriteReferenceDoc(markdown: string, blocks: Record<string, string>): string {
  let next = markdown;
  for (const [id, body] of Object.entries(blocks)) {
    const start = `<!-- generated:${id}:start -->`;
    const end = `<!-- generated:${id}:end -->`;
    if (next.split(start).length !== 2 || next.split(end).length !== 2) throw new Error(`Expected one marker pair for ${id}`);
    const from = next.indexOf(start) + start.length;
    const to = next.indexOf(end);
    if (from > to) throw new Error(`Reversed markers for ${id}`);
    next = `${next.slice(0, from)}\n\n${body}\n\n${next.slice(to)}`;
  }
  return next;
}
