/**
 * Shared code asks what a zone or an item is through the game's predicates, category roles and traits,
 * never by its id. Outside `core/game`, no production code compares a `CellZone` member (an equality
 * operand or a `case` label); outside the catalog data in `config/`, the engine and editor layers name
 * no `ItemCategory` member, neither as `ItemCategory.X` nor as its id string compared with a category,
 * and write no catalog item, landmark or map template id as a string (the ids are read from `config/`
 * and the profile), as a string or as an identifier such as a property name. A frozen wire table (`FROZEN_WIRE`) must spell them, because what it writes
 * is already in saves and codes; it is exempt as a file, with its reason, and fails here once it no
 * longer spells any.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { SRC, parseSource, sourceFiles, srcRelative } from '../_support/source-graph';
import { CATEGORIES, ItemCategory } from '../../config/catalog/categories';
import { MAP_TEMPLATES } from '../../config/maps';
import { LANDMARKS } from '../../core/game/profile';

type Check = 'zoneComparison' | 'category' | 'gameId';
const CHECKS: readonly Check[] = ['zoneComparison', 'category', 'gameId'];

/** The frozen wire tables, each with why it spells game facts. */
const FROZEN_WIRE: Readonly<Record<string, string>> = {
  'src/io/share/codec/catalog-order.ts': 'the share-code item table: an item\'s position is its index in every code already shared, so it spells each id',
  'src/io/save/format/migrations/001-v1-to-v2.ts': 'the version 1 to 2 save migration: it rewrites the ramp ids version 1 saves wrote',
  'src/io/share/codec/template-record.ts': 'the share-code template record: one bit per cell records grass',
  'src/io/share/codec/template-mask.ts': 'the share-code buildable masks: append-only revisions keyed by the built-in template ids codes already carry',
};

/** Every catalog item, landmark and built-in map template id. */
const GAME_IDS: ReadonlySet<string> = new Set([
  ...CATEGORIES.flatMap((c) => c.items.map((item) => item.id)), ...LANDMARKS.map((l) => l.id), ...Object.keys(MAP_TEMPLATES),
]);

/** The layers the portability rule speaks for: everything but the UI, its copy and the data. */
const CATEGORY_LAYERS = /^(?:core|state|rules|tools|view|pipelines|editor|agent|io)\//;
const EQUALITY = new Set(
  [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken],
);

const CATEGORY_IDS: ReadonlySet<string> = new Set(Object.values(ItemCategory));
const isCategoryId = (node: ts.Node): boolean => ts.isStringLiteralLike(node) && CATEGORY_IDS.has(node.text);
/** An expression that reads a category: a name or property called `cat` or ending in `category`. */
const readsCategory = (node: ts.Node): boolean => {
  const name = ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? node.name.text : '';
  return name === 'cat' || /[cC]ategory$/.test(name);
};

/** A category id written as a string and compared with a category read, or a `case` of a switch over one. */
function isCategoryLiteral(node: ts.Node): boolean {
  if (!isCategoryId(node)) return false;
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && EQUALITY.has(parent.operatorToken.kind)) {
    return readsCategory(parent.left === node ? parent.right : parent.left);
  }
  return ts.isCaseClause(parent) && parent.expression === node && readsCategory(parent.parent.parent.expression);
}

const memberOf = (node: ts.Node, enumName: string): node is ts.PropertyAccessExpression =>
  ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === enumName;

/** A `CellZone.X` read as an id compared: either side of an equality, or a `case` label. */
function isZoneComparison(node: ts.PropertyAccessExpression): boolean {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && EQUALITY.has(parent.operatorToken.kind)) return true;
  return ts.isCaseClause(parent) && parent.expression === node;
}

/** A game id written as a string, or as an identifier: a property name (`{ hexia: ... }`,
 *  `MAP_TEMPLATES.tafa`) or any other name spelled like one. */
const namesGameId = (node: ts.Node): boolean =>
  (ts.isStringLiteralLike(node) || ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && GAME_IDS.has(node.text);

function count(path: string, text: string): Record<Check, number> {
  const source = parseSource(path, text);
  const n: Record<Check, number> = { zoneComparison: 0, category: 0, gameId: 0 };
  const rel = path.startsWith('src/') ? path.slice(4) : path;
  const visit = (node: ts.Node) => {
    if (!rel.startsWith('core/game/') && memberOf(node, 'CellZone') && isZoneComparison(node)) n.zoneComparison++;
    if (CATEGORY_LAYERS.test(rel) && (memberOf(node, 'ItemCategory') || isCategoryLiteral(node))) n.category++;
    if (CATEGORY_LAYERS.test(rel) && !rel.startsWith('core/game/') && namesGameId(node)) n.gameId++;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return n;
}

/** Every site each check finds, per file, and how many a frozen wire table holds. */
function scan(): { found: Record<Check, Map<string, number>>; frozen: Map<string, number> } {
  const found: Record<Check, Map<string, number>> = { zoneComparison: new Map(), category: new Map(), gameId: new Map() };
  const frozen = new Map<string, number>();
  for (const file of sourceFiles(SRC)) {
    const path = `src/${srcRelative(file)}`;
    const n = count(path, readFileSync(file, 'utf8'));
    if (path in FROZEN_WIRE) frozen.set(path, CHECKS.reduce((sum, check) => sum + n[check], 0));
    else for (const check of CHECKS) if (n[check] > 0) found[check].set(path, n[check]);
  }
  return { found, frozen };
}

const { found, frozen } = scan();

describe('game facts in shared code', () => {
  it.each(CHECKS)('holds no %s site outside the frozen wire tables', (check) => {
    const sites = [...found[check]].map(([path, n]) => `${path}: ${n}`);
    expect(sites, 'ask a zone predicate, a category role, a catalog trait or a template field instead').toEqual([]);
  });

  it('exempts only frozen wire tables that still spell game facts', () => {
    expect(Object.keys(FROZEN_WIRE).filter((path) => !(frozen.get(path)! > 0))).toEqual([]);
  });

  it('reads a compared zone and a named category, and leaves a zone written or a category declared alone', () => {
    const planted = [
      'if (cell.zone === CellZone.Beach) f();',
      'switch (z) { case CellZone.Void: break; }',
      'const cell = { zone: CellZone.Grass };',
      'const plant = item.category === ItemCategory.Tree;',
      "if (o.category === 'tree') g();",
      "switch (cat) { case 'flora': break; }",
      "if (kind === 'bridge' || label === 'road') h();",
      'enum Local { A = 1 }',
      `const anchor = '${LANDMARKS[0]!.id}';`,
      `if (state.templateId === '${Object.keys(MAP_TEMPLATES)[0]}') k();`,
      `const masks = { ${Object.keys(MAP_TEMPLATES)[0]}: 1 };`,
      `const mask = MAP_TEMPLATES.${Object.keys(MAP_TEMPLATES)[0]};`,
    ].join('\n');
    expect(count('src/tools/x.ts', planted)).toEqual({ zoneComparison: 2, category: 3, gameId: 4 });
    expect(count('src/core/game/x.ts', planted)).toEqual({ zoneComparison: 0, category: 3, gameId: 0 });
    expect(count('src/ui/x.ts', planted)).toEqual({ zoneComparison: 2, category: 0, gameId: 0 });
  });
});
