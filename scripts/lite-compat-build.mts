import ts from 'typescript';
import rewritePattern from 'regexpu-core';
import type { Plugin } from 'vite';

/** Only lower CSS objects; geometry and palette data also use names such as `inset` and `gap`. */
function isStyleObject(node: ts.Node): boolean {
  for (let context: ts.Node | undefined = node.parent; context; context = context.parent) {
    if (ts.isJsxAttribute(context)) return /^(style|\w+Style)$/.test(context.name.getText());
    if (ts.isAsExpression(context) || ts.isSatisfiesExpression(context)) {
      if (/\b(CSSProperties|MotionStyle)\b/.test(context.type.getText())) return true;
    }
    if (ts.isVariableDeclaration(context) || ts.isFunctionLike(context)) {
      return !!context.type && /\b(CSSProperties|MotionStyle)\b/.test(context.type.getText());
    }
    if (ts.isPropertyAssignment(context) && /^(style|\w+Style)$/.test(context.name.getText())) return true;
  }
  return false;
}

// These library loaders and code generators are unreachable in the offline renderer paths.
// Other dependency calls stay intact so the packaged-artifact check rejects newly introduced APIs.
const OFFLINE_DEPENDENCY = /\/node_modules\/(?:function-bind\/implementation\.js|three\/build\/three\.module\.js|@pixi\/(?:settings\/lib\/adapter|core\/lib\/(?:shader\/utils\/(?:unsafeEvalSupported|generateUniformsSync|generateUniformBufferSync)|textures\/resources\/(?:ImageResource|ImageBitmapResource)))\.[cm]?js)$/;

/** Lower Unicode regexes before the bundler turns unsupported literals into runtime constructors. */
export function liteCompatibilityPlugin(): Plugin {
  return {
    name: 'petit-lite-compatibility',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.[cm]?[jt]sx?$/.test(id) || (!code.includes('\\p{') && !id.includes('/src/ui/') && !/\b(fetch|Function)\b/.test(code))) return;
      const file = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, id.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
      const edits: { start: number; end: number; value: string }[] = [];
      const visit = (node: ts.Node) => {
        if (OFFLINE_DEPENDENCY.test(id.replace(/\\/g, '/')) && (ts.isCallExpression(node) || ts.isNewExpression(node))) {
          const callee = node.expression;
          const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
          if (name === 'fetch' || name === 'Function') {
            const value = name === 'fetch' ? "Promise.reject(new Error('Offline resource loader unavailable'))" : "(() => { throw new Error('Dynamic code generation unavailable'); })()";
            edits.push({ start: node.getStart(file), end: node.end, value });
            return;
          }
        }
        if (id.includes('/src/ui/') && ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && isStyleObject(node)) {
          const key = node.name.text;
          const value = node.initializer.getText(file);
          if (key === 'inset') edits.push({ start: node.getStart(file), end: node.end, value: `top: ${value}, right: ${value}, bottom: ${value}, left: ${value}` });
          else if (key === 'aspectRatio') edits.push({ start: node.getStart(file), end: node.end, value: `'--lite-ratio': ${value}, aspectRatio: ${value}` });
          else if (key === 'gap') edits.push({ start: node.getStart(file), end: node.end, value: `'--lite-gap': ${value}, gridGap: ${value}, gap: ${value}` });
        }
        if (ts.isRegularExpressionLiteral(node) && node.text.includes('\\p{')) {
          const end = node.text.lastIndexOf('/');
          const flags = node.text.slice(end + 1);
          const pattern = rewritePattern(node.text.slice(1, end), flags, { unicodePropertyEscapes: 'transform' });
          edits.push({ start: node.getStart(file), end: node.end, value: `/${pattern}/${flags}` });
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
      for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.value + code.slice(edit.end);
      return edits.length ? { code, map: null } : undefined;
    },
  };
}
