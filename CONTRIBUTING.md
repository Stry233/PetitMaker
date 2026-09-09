# Contributing to PetitMaker

Thanks for your interest in PetitMaker, an unofficial map editor for *Petit Planet*. This guide covers how contributions are licensed and the sign-off we require. Please read it before opening a pull request.

## At a glance

- **Code contributions** are licensed **inbound = outbound** under **Apache-2.0**.
- Every commit must carry a **Developer Certificate of Origin** sign-off (`Signed-off-by:`), added with `git commit -s`.
- **Contributors retain copyright** in their contributions; you license your work to the project, you do not assign ownership to it.
- **Art / non-code asset contributions** require separate **written permission** before they can be merged.
- We only publish a contributor's name with their **consent**.

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

We only publish a contributor's name (in credits, the About screen, release notes, or elsewhere) **with that person's consent**. If you contribute, let us know whether and how you would like to be credited; we will record your preference and will not publish your name without permission.

## Development setup

International site: https://petitmaker.cc/

Chinese site: https://petitmaker.com.cn/

Requires [Node.js](https://nodejs.org) 24 or newer.

```bash
npm install
npm run hooks:install   # once per clone: the pre-commit hook that stamps build-info.json
npm run dev             # Vite dev server
npm run test:run        # run the test suite (Vitest)
npm run lint            # TypeScript type-check (tsc --noEmit)
npm run build           # production build
```

Please run `npm run test:run` and `npm run lint` before opening a pull request, and keep changes focused. For architecture and conventions, see `docs/ARCHITECTURE.md`.

The marked reference sections in [ARCHITECTURE.md](docs/ARCHITECTURE.md) are generated from runtime constants, rule registration, and TypeScript contracts. Run `npm run docs:generate` after changing those sources; `npm run docs:check` and the test suite reject stale generated sections. Keep explanations and rationale outside the generated markers, and link to code for facts that do not need a reference table. Provider disclosures, Help facts (including autosave timing and agent turn limits) and keyboard hints already derive from their respective registries; legal pages, headers and dependency notices have their own generators.

## Questions

For contribution questions, or to arrange an asset-permission or credit record, email **selka.craft@outlook.com**. Security issues follow a separate process. See `SECURITY.md`.
