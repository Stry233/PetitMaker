# PetitMaker (Lite) for Xiaohongshu

PetitMaker (Lite) (谷地工坊 (Lite)) is an offline edition for Xiaohongshu’s 小工具 container. It shares PetitMaker’s map rules, terrain and object tools, annotations, undo and redo, local autosave, seven interface languages, and 2D and supported-device 3D views.

## Build and preview

Use the same Node version and dependencies as the web edition. Lite builds also use the installed development dependencies to convert bundled images to WebP and lower Unicode regular expressions.

Packaged versions use the computed version with a `-lite` suffix, such as `1.3.10-lite`. Local development builds also retain `-dev`.

```sh
npm ci
npm run build:lite
npx vite preview --mode lite
```

The build creates `dist-lite/` and a versioned ZIP in `artifacts/lite/`, named `petitmaker-<version>-lite-<hash>.zip`. Each ZIP has a JSON manifest containing its version, source build, byte size and SHA-256 checksum; `artifacts/lite/latest.json` identifies the latest build. Identical builds reuse the same file, while changed contents get a new hash and preserve previous builds. The artifacts directory is ignored by Git, and ZIPs are excluded from the public source snapshot.

The ZIP has one `index.html` at its root and relative references to its bundled resources. Upload the ZIP through Xiaohongshu’s tool uploader. An ordinary browser can preview and edit the map; saving to an album and creating a note become available when the Xiaohongshu container provides its SDK.

`npm run dev:lite` starts the development server. Its policy permits local development scripts and hot reload. Test the production ZIP or production preview when checking the offline restrictions. `npm run build` continues to create the full web edition in `dist/`.

## Features and limits

| Area | Lite behavior |
| --- | --- |
| Editing | Terrain, roads, objects, layers, annotations, undo and redo use the shared editor and game rules. |
| Viewing | 2D works with WebGL or the Canvas2D fallback. 3D requires WebGL2. Settings retains Auto, Full and Light. Auto starts with shadows and multisampling disabled; Full uses a 1024-pixel shadow map and bounded 2-sample antialiasing. Drawing buffers start at at most 1× density and approximately one million pixels. On hardware with sustained rendering headroom, Auto and Full raise clarity up to the web edition’s device-density cap of 2×, with an eight-million-pixel ceiling. Light stays conservative. Sustained slowdown reduces effects and resolution, and stops further increases for that scene. Resource pressure lowers quality when frames exceed the rendering time budget. Only sustained slow rendering after reaching the minimum quality returns to 2D; cursor redraws and scene complexity alone do not force that fallback. |
| Saving | Local autosave restores the map and available undo history on the same device. Container data can be cleared, so this is not a portable backup. |
| Pictures | The shared image composer provides title and description fields, four output sizes, layer previews, editable 3D shots, grid and annotation controls, and a customizable footer. Lite’s Share Image and Plain Image presets set presentation defaults; Share Image enables PetitGlyph by default so the picture can carry an editable map. Plain Image leaves it out by default. Save to album and Create a note use the injected Xiaohongshu SDK after the export acknowledgement. Opening the composer does not publish the note. |
| Imports and portable saves | Import opens PNG, JPEG and WebP pictures containing PetitGlyph, previews the recovered map and asks before replacing the current one. Save a Standard or larger picture with Importability enabled to include PetitGlyph. JSON file import/export and clipboard share codes are omitted. |
| Generation | Planet and Maze retain recipe thumbnails, settings, custom seeds and region selection. Previews run one at a time on the main thread. Letter, Picture and illustration generation are omitted. |
| Assistant | AI assistant and provider settings are omitted. |
| Platform features | No external navigation, clipboard, browser downloads, full-screen requests, network calls, Web Workers or WebAssembly. |
| Guidance | The first-launch tour, Replay the tour, searchable Help and contextual help cover Lite’s available editor features. About uses the shared web-edition layout and document reader, with branding, build details, team and community credits, a selectable feedback address and offline licenses. External navigation, clipboard actions, sponsorship links and web-only policy pages are omitted. |

Xiaohongshu client 9.37 or later is required for the data-URI images used by map previews and recipe thumbnails.

Lite keeps the editor wider than it is tall. In a portrait container it rotates the entire interface clockwise, including dialogs, and maps pointer input into that landscape layout. Safe areas are reserved outside the editor; while a text field has focus, the layout keeps its orientation and fits above the keyboard. This does not request a native orientation lock. Lite uses system fonts and resized WebP art. Its initial 3D profile is conservative; resolution can increase after observing smooth interaction.

## Container integration

The implementation follows the [official mini-tool ZIP builder 1.6.0](https://fe-static.xhscdn.com/mini-tool/20260831163932/minitool-zip-builder-1.6.0.skill), with its ES2017 / Chrome 61 baseline, classic scripts, relative packaged resources and 10 MiB upload limit. The earlier [小工具容器技术规范与 API 文档](https://fe-video-qc.xhscdn.com/fe-platform-file/104101b8323q4m0uaga06277180ac7t8006ptl0e12ek1g#s5), updated August 11, 2026, provides additional background. The container supplies `window.xhs.miniTool`; the package does not fetch an SDK.

The image adapter sends a PNG data URI to `writeTempFile` when available and passes the temporary path to `saveImageToPhotosAlbum`. `postNote` receives the complete PNG data URI directly. If the temporary-file helper is absent, the documented data-URI input is used directly. Temporary paths are never persisted. No note title, content or tags are filled automatically. SDK failures leave the editor and preview available for another attempt.

The container owns the production content security policy; the ZIP contains no CSP meta tag. The local verification server enforces an equivalent offline policy through an HTTP header. Build aliases exclude the assistant surfaces and replace worker entry points with main-thread implementations. Packaging rejects unsupported file extensions and worker/model runtime files. Bundled dependency license text may mention capabilities that this edition does not use.

Before submitting, test the ZIP in the real Xiaohongshu container on iOS and Android: cold launch, touch editing, undo, restoring after closing the tool, 2D and 3D, Planet and Maze thumbnails and application, PetitGlyph export and image import, portrait touch and pinch gestures, safe areas, the software keyboard, all window sizes, album permission rejection and retry, and cancelling or completing the note composer. Browser tests with an injected SDK double verify adapter calls but cannot establish native permissions, platform acceptance or device performance.

## Validation limits

The ZIP size check and bundled-script checks run during `npm run build:lite`. The build rejects module syntax, disallowed runtime calls, oversized embedded base64 and ZIPs over 10 MiB. The official size audit can still warn above its recommended 2 MiB target or about large uncompressed JavaScript. The single script includes the editor, both renderers, seven locales and map templates; compression does not eliminate their parse and memory cost.

Desktop browser checks and tests with selected modern APIs removed are not physical-device validation. Chrome 61 CSS compatibility, Xiaohongshu native permissions and low-end device performance require testing in the official simulator and real iOS / Android container.

## Maintaining both editions

The ordinary web and offline Lite editions are build targets of the same source tree. `npm run build` preserves the web entry point, modern bundling, assets and graphics settings; `npm run build:lite` selects the container entry point, offline adapters and Chrome 61 compatibility transforms. Legacy syntax support does not determine rendering resolution.

`core/runtime/edition.ts` declares platform capabilities. `scripts/edition-build.mts` selects build adapters and rejects Lite adapters in a web bundle. Keep host operations behind those boundaries, and keep map rules, editing tools, session persistence and reusable interface components shared. The app roots own their distinct startup and host surfaces; both use `useEditorSession` for saving and restoring maps, notes, history and cameras. `ui/shell/windows/EditorWindows.tsx` wires common windows and planet changes, with host feedback supplied by each edition. Export preset behavior belongs in the edition adapters beside review and stylization availability.

Only the Lite build applies compatibility rewrites. Offline dependency substitutions name specific files; a newly introduced network or dynamic-code call fails packaging rather than being silently rewritten. CSS fallbacks activate only when the corresponding feature is absent and revisit affected DOM subtrees. Modern browsers retain their native layout behavior.

Both build commands work from a clean checkout with `npm ci`. `scripts/lite-validation.mts` owns final script and resource validation; `lite-package-core.mts` owns file collection, deterministic archive creation and versioned storage; `package-lite.mts` supplies the build identity and reports the result. Validation checks the collected bytes for HTML, CSS and SVG resource paths, script syntax, disallowed calls, embedded resource limits and ZIP size, and reports size advisories. No downloaded skill or local preview directory is needed. Shared tests, both builds and separate web/Lite browser checks protect changes to shared code; device validation remains necessary before XHS submission.
