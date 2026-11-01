# Contributing to PetitMaker

Thanks for your interest in PetitMaker, an unofficial map editor for *Petit Planet*. This guide covers how contributions are licensed and the sign-off we require. Please read it before opening a pull request.

## At a glance

- **Code contributions** are licensed **inbound = outbound** under **Apache-2.0**.
- Every commit must carry a **Developer Certificate of Origin** sign-off (`Signed-off-by:`), added with `git commit -s`.
- **Contributors retain copyright** in their contributions; you license your work to the project, you do not assign ownership to it.
- **Art / non-code asset contributions** require separate **written permission** before they can be merged.
- Project-page credits follow the contributor's **consent**; Git authorship and DCO sign-offs are public commit records.

## Developer Certificate of Origin (DCO)

We use the **Developer Certificate of Origin 1.1** instead of a CLA. The DCO is a lightweight statement (reproduced below) that you have the right to submit the work under the project's license. You agree to it by **signing off** each commit.

Add the sign-off automatically with:

```bash
git commit -s -m "your message"
```

This appends a line to the commit message using your real (or usual) name and email:

```
Signed-off-by: Your Name <you@example.com>
```

Commits without a valid `Signed-off-by:` line will not be merged; maintainers check for it during review. If you forget, amend with `git commit --amend -s` (or rebase with sign-off) and force-push the branch.

<details>
<summary>Developer Certificate of Origin 1.1 (full text)</summary>

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

</details>

## Code license (inbound = outbound)

Code contributions are accepted under **Apache-2.0**, the same license the project ships under (see `LICENSE` and `NOTICE`). By signing off, you license your code contribution to the project and its users under Apache-2.0.

**You retain copyright** in your contributions. The project does not require copyright assignment and does not act as a collective owner of your work. The copyright stays with each contributor, licensed under Apache-2.0 (see `docs/ASSET_LICENSES.md` for the full code-vs-brand-vs-asset scope split).

## Art & non-code asset contributions

Art, icons, fonts, sounds, and other non-code assets are **not** covered by the code license and cannot be merged on a DCO sign-off alone. Before such a contribution is accepted, the maintainers must verify written permission that identifies the contributor, the covered material, and the granted rights. `docs/ASSET_LICENSES.md` carries the public license and source summary.

If you want to contribute an asset, contact us first (see below) so we can confirm what evidence is required. Do not submit third-party or game-derived material you do not have the right to license.

## Credit & naming

Names, email addresses and content in Git commits and DCO sign-offs enter version history and may remain public when submitted to the public repository. Choose a name and email suitable for publication before submitting. Separate credits in project pages, About and acknowledgements follow your preferences; please tell us whether and how you would like to be credited.

## Development setup

International site: https://petitmaker.cc/

Chinese site: https://petitmaker.com.cn/

Requires [Node.js](https://nodejs.org) 24 or newer.

```bash
npm install
npm run dev             # Vite dev server
npm run check           # lint, production build and the test suite: run before a pull request
npm run test:run        # the test suite (Vitest), without the slow tier
npm run test:spec       # the tests of the behaviour specification only
npm run test:slow       # the slow tier: the file-format corpora, generation, Smart Build, the toolbars
npm run lint            # TypeScript type-check and ESLint (app, scripts and tests)
npm run build           # production build
```

Please run `npm run check` before opening a pull request, and `npm run test:slow` when you changed something a `.slow.` test covers, and keep changes focused. For architecture and conventions, see `docs/ARCHITECTURE.md`.

The marked reference sections in [ARCHITECTURE.md](docs/ARCHITECTURE.md) are generated from runtime constants, rule registration, and TypeScript contracts. Run `npm run docs:generate` after changing those sources; `npm run docs:check` and the test suite reject stale generated sections. Keep explanations and rationale outside the generated markers, and link to code for facts that do not need a reference table. Provider disclosures, Help facts (including autosave timing and agent turn limits) and keyboard hints already derive from their respective registries; legal pages, headers and dependency notices have their own generators.

## Repository guards

Part of the test suite checks the structure of the code rather than its behaviour. When one of these tests fails, its header comment explains the rule; this section summarizes them.

- **Layers import downward.** Every top-level folder of `src/` (apart from `lite/` and `__tests__/`) is a layer, ranked in `scripts/layers.mts`; the stack is drawn in [ARCHITECTURE.md](docs/ARCHITECTURE.md#architecture-at-a-glance). A module imports from its own layer or a lower one. A type-only import that points up is allowed only with a reason recorded in `src/__tests__/repo/import-direction-allowlist.json`. When lower code needs something from above, it declares an interface and receives the implementation as an argument. `src/__tests__/repo/import-direction.test.ts` enforces this, and `src/core` has its own folder order, in which type-only imports count too.
- **Allowlists only shrink.** Files such as `src/__tests__/repo/import-direction-allowlist.json` record the exceptions that remain, each with its reason. When your change fixes an exception, remove its entry in the same change: an entry nothing needs any more fails, and an allowlist that empties is deleted so its guard admits no exception. Adding an entry needs a written reason in the pull request, and reviewers will question it. Never weaken a guard or a map rule to make a test pass.
- **The interface only presents.** Files under `src/ui/` render state, capture input and call verbs: a handler runs one store action or one editor verb, and workflows, policies and store orchestration live in the layers below. The interface reads `src/io/`, `src/tools/` and `src/pipelines/` only through their fact modules (`facts.ts`), and hears map changes through `src/ui/session/`. Review holds this.
- **Design values have one home.** Colours, shadows, z-index rungs, radii, spacing and motion timing are declared in `src/ui/design/` and named everywhere else. A drawing zone (Help figures, the assistant's sketchbook, the tour diagrams) draws illustrations to their own scale, so it keeps its own shapes, spacing and motion, but its colours still come from `src/ui/design/drawing-palette.ts`. Review holds both.
- **Libraries never import pointer tools.** In `src/tools/`, the pointer tools live under `pointer/`; every other folder is a library shared with generation and the assistant, and imports nothing under `pointer/` (`src/__tests__/tools/doors.test.ts`).
- **Comments state facts.** A comment says what the code cannot: invariants, units, platform behaviour, non-obvious consequences. It does not restate the code, cite a ticket, task or measurement run, defend the implementation or narrate earlier behaviour. Write in plain sentences with no emphasis in capitals and no capital letter in mid-sentence (write "not a texture", not "not A texture").
- **English in code.** Code, identifiers, comments, test names and data are written in English. Translated text lives only in `src/i18n/locales/`.
- **Every string in all seven locales.** User-facing text goes through i18n: add the key to `src/i18n/locales/en.ts` and to each of the other six locale tables, written as native copy. UI text uses no em dashes and no dot separators (`src/__tests__/i18n/copy-punctuation.test.ts`); the parity tests reject a missing key.
- **Tests prove the specification.** [docs/spec/](docs/spec/README.md) lists what the editor does, one requirement per id. A test proves a requirement through a public entry point (the headless editor world, the save and share functions, a rendered control's role and label) and opens its title with the id it proves, as in `[V-PLACE-DOOR] refuses a house whose door faces a cliff`; a title citing an id the specification lacks fails. A change that alters behaviour updates its requirement in the same pull request.
- **Where tests go.** Specification tests live in `src/__tests__/spec/<area>/`, other tests under `src/__tests__/` in the folder of their subject, shared builders and stubs in `_support/`, data in `fixtures/<domain>/` and repository-wide guards in `repo/`. A file that takes ten seconds or more is named `<name>.slow.test.ts` and runs in `npm run test:slow`.
- **Tests run the code.** A test pins behaviour by calling the code, not by matching its source text or its internals (private fields, mocks of internal modules, call order), which break on a rename and pass when the behaviour breaks. Only repository guards read source on purpose.
- **Test hooks carry a prefix.** An export that exists only for tests is named `__reset*` or `__set*`, and no production module calls it.
- **Module state has one of three jobs.** Each module-level `let`, `const` collection its module writes, and signal in `src/` is a cache, a page-wide registration or the one instance of a page-wide mechanism.

## Questions

For contribution questions, or to arrange an asset-permission or credit record, email **petit.maker@outlook.com**. Security issues follow a separate process. See `SECURITY.md`.
