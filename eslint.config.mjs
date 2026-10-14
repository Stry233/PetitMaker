// ESLint runs after the TypeScript programs in `npm run lint`. tsc owns types, unused names and
// strictness; this config adds the rules tsc cannot express. No violation has a baseline: each is
// fixed, or carries an inline disable with its reason.
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import ts from 'typescript';

const ROOT = import.meta.dirname;
const SOURCES = ['src/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx,mts}', 'security/**/*.ts', '*.ts'];

// Type-aware rules read one program, `tsconfig.eslint.json`: the shipped code and every script
// with one shared checker. Loading each typecheck program separately held four copies of src at
// once; one program over the tests too needs twice the heap of the shipped code alone.
const LINT_PROGRAM = 'tsconfig.eslint.json';

// The tests are the files that program excludes; a bare directory there means everything below it.
const TESTS = ts.readConfigFile(`${ROOT}/${LINT_PROGRAM}`, ts.sys.readFile).config.exclude
  .map((pattern) => (/[*.]/.test(pattern) ? pattern : `${pattern}/**`));

export default defineConfig(
  // JavaScript is not linted: the ES5 boot guard, Lite's classic polyfills, the compat page driver
  // (`unchecked-scripts-allowlist.json`) and this config. Scripts are TypeScript.
  // Nested worktrees, scratch and build output carry their own copies of the tree.
  { ignores: ['**/*.{js,mjs,cjs,jsx}', '.claude/**', '.superpowers/**', 'artifacts/**', 'dist*/**', 'node_modules/**'] },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  {
    files: SOURCES,
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    rules: {
      // A deliberate dependency list carries `eslint-disable-next-line` with its reason after `--`.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // More than five positional arguments is a call site nobody can read; pass an options object.
      'max-params': ['error', 5],
      // Code only: comments, strings, templates, URLs and regular expressions may run longer.
      'max-len': ['error', {
        code: 160,
        ignoreComments: true,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
      }],
    },
  },
  {
    files: SOURCES,
    ignores: TESTS,
    languageOptions: { parserOptions: { project: [LINT_PROGRAM], tsconfigRootDir: ROOT } },
    rules: {
      // The cache in `npm run lint` keys on each file alone: a callee turning async elsewhere is
      // caught on the next cold run.
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
);
