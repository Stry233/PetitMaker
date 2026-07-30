# Legal document bodies

The markdown in this directory is **authored for the app**: `privacy`, `terms`, `about`, and `contact`, as `<id>.en.md` + `<id>.zh.md` pairs. They are imported `?raw` by `../registry.ts`, which is also the structural contract they write into (required sections, effective date, policy version) and the only place that resolves their `{app}` / `{origin}` / `{email}` / `{operator}` / `{team}` / `{providers}` tokens. Never hardcode a value a token already resolves, and never hand-copy data that lives in `../config.ts` (`LEGAL`).

Write one line per paragraph, list item, or table row. Hard-wrapping a paragraph across several lines is a manual line feed the renderer has to undo, and it makes every later edit rewrap the block.

## The app renders six more documents that are NOT here

Each of the following IS a repo file that exists for its own sake, so the app renders that file directly and the GitHub view, the static page, and the in-app doc view cannot drift from one another. Copying them here would mean two files per document plus a guard to hold them equal.

| Document | Source | Why it lives there |
|---|---|---|
| License | `LICENSE` | Byte-exact upstream Apache-2.0 text, sha256-pinned. GitHub reads it at the repo root for license detection. |
| Third-party notices | `docs/THIRD_PARTY_NOTICES.md` | **Generated** by `scripts/license-audit.mts` from the lockfile + shipped bundle. Never hand-edit; run `npm run legal:licenses`. |
| Asset licenses | `docs/ASSET_LICENSES.md` | Public doc, linked from both READMEs. |
| Security policy (en) | `SECURITY.md` | Where GitHub looks for a vulnerability policy, which is what makes the "Report a vulnerability" affordance appear. |
| Security policy (zh) | `docs/SECURITY.zh-CN.md` | The zh mirror of the above; parity-tested against it. |
| Changelog | `docs/CHANGELOG.md` | Public doc, linked from both READMEs. |

Every registry entry declares which case it is (`sourceKind`: `authored` | `canonical-root` | `generated`) together with its `sourcePath`, and `src/__tests__/legal/doc-sources.test.ts` holds those declarations to the filesystem — the declared path must exist, its bytes must be the bytes the registry imported, the path must match the kind, and this directory must contain exactly the authored bodies. Adding a document in some third arrangement fails a test rather than quietly establishing a new convention.
