# Asset Licenses & Provenance

**At a glance:** this repository mixes materials under different terms. **Code is Apache-2.0. The brand, logo, and original art are All Rights Reserved unless stated otherwise. Third-party assets and fonts keep their own licenses. User-created maps belong to their creators.** Do not assume that because the code is open source, the art, brand, or any game-referential material is free to reuse. This document is the map of who owns what; it is a provenance record, **not** a grant of permission.

PetitMaker, whose Chinese name is 谷地工坊, is an independent, unofficial fan project. It is **not affiliated** with, endorsed by, or sponsored by miHoYo / HoYoverse (COGNOSPHERE PTE. LTD.). *Petit Planet*, whose Chinese name is 星布谷地, and related names, characters, and material are the property of their respective owners.

## Scope split

The repository contains four distinct classes of material, each under its own terms:

1. **Code**: the application and tooling source code, plus configuration files that are not assets or document content assigned different terms below. Licensed **Apache-2.0** (see `LICENSE` and `NOTICE`). Inbound code contributions are under the same license (see `CONTRIBUTING.md`). A file is not Apache-2.0 merely because it sits under `src/` or `scripts/`.
2. **Brand, logo, and original art**: the PetitMaker name and logo, and original artwork created for the project. Examples include the catalog item sprites under `src/assets/icons/catalog/` and the UI chrome icons under `src/assets/icons/ui/`, and the original low-poly 3D model specifications (`model3d`) authored in the catalog JSON. These are **All Rights Reserved** unless a specific file or section states otherwise. They are **not** covered by the code's Apache-2.0 license. The project's original art is led by **火山野牛王**. (Sharing your own editor exports that embed this art is expressly permitted; see [Sharing what you export](#sharing-what-you-export).)
3. **Third-party assets and fonts**: third-party materials keep **their own licenses**; nothing here overrides or relicenses them. Bundled software dependencies are recorded in `THIRD_PARTY_NOTICES.md`; the shipped fonts (Alibaba PuHuiTi 3 and Quicksand), together with their exact license texts and subsetting findings, are recorded in the **Fonts** section of `THIRD_PARTY_NOTICES.md`; refer to that section rather than this file for font terms.
4. **User maps**: the **User maps** and other content a user creates in the editor are the rights of their respective creators, subject to any third-party material they incorporate (game-referential names, templates, or assets remain their owners'). For the images and files you export and share, see [Sharing what you export](#sharing-what-you-export).

## Sharing what you export

The images and files the editor produces for you (screenshots, exported map files, share images including the PetitGlyph code band, and 3D preview captures) necessarily embed artwork from classes 2 and 3 above alongside your own map design: a map is drawn with item sprites, and a share card carries project art. So that the ownership split above never contradicts the tool's purpose:

- **You may share your exports.** We grant every user a non-exclusive, royalty-free, worldwide permission to publish, display, and share the images and files this editor exports of their own maps, including the PetitMaker brand elements and original artwork embedded in them, in any medium. The class-2 "All Rights Reserved" restricts standalone reuse of the art (extracting sprites, redistributing the icon set, using the name or logo elsewhere), **not** the sharing of your exports.
- **This permission does not cover extraction.** Cropping, extracting, or reproducing embedded artwork for use outside the context of sharing your own map is reuse of the underlying asset and requires its own permission (see [How to request permission](#how-to-request-permission)).
- **Game-referential material remains its owners'.** Where embedded material references *Petit Planet*, your sharing of it remains subject to the game owner's own terms and fan-content policies. We can only grant rights to what we hold; we cannot and do not grant rights on the game owner's behalf.
- **AI-assisted illustrations can carry additional terms.** An illustration made by an online provider is also subject to that provider's terms. An online or on-device illustration may reproduce rights-protected material from its source map or any supplied reference. Our permission covers only the PetitMaker elements we own; it does not guarantee that an AI-assisted result is exclusive or clear of third-party rights.
- **No transfer, no endorsement.** This permission is the same for every user, does not transfer ownership of any embedded material, and does not make an export official game content or content endorsed by us or by the game's publisher.

## Ownership matrix

### Code

| Item | License | Owner | Notes |
|---|---|---|---|
| Application and tooling source code, and non-asset configuration | Apache-2.0 | PetitMaker contributors | See `LICENSE` / `NOTICE`; contributors retain copyright and license inbound=outbound. Assets and authored document content listed elsewhere in this file retain their stated terms. |
| Bundled software dependencies | Their own licenses | Upstream authors | Enumerated in `THIRD_PARTY_NOTICES.md`; full texts under `licenses/<pkg>/`. |

### Brand & original art

| Item | License | Owner | Notes |
|---|---|---|---|
| PetitMaker name and logo | All Rights Reserved | PetitMaker | Not licensed under Apache-2.0. |
| Catalog item sprites (`src/assets/icons/catalog/`) | All Rights Reserved (unless stated) | 火山野牛王 | Project-created item art, except the game-derived `path-*.png` surfaces listed below. The project has verified permission to ship the original sprites and to let users share editor exports that embed them; game-referential publication remains subject to the disclosure below. |
| UI chrome icons (`src/assets/icons/ui/`) | All Rights Reserved (unless stated) | 火山野牛王 | Interface art created for the project. The project has verified permission to ship it and to let users share editor exports that embed it. |
| Drawn cursor art (`src/assets/cursors/*.svg`) | All Rights Reserved; project publication permission under review | 火山野牛王 | Generated from project design art. No standalone reuse license is granted, and the project's publication basis for this path is not yet complete. |
| Extracted shell art (`src/assets/shell/`) | All Rights Reserved; project publication permission under review | 火山野牛王 | Interface plates, illustrations, and glyphs generated from project design art. No standalone reuse license is granted, and the project's publication basis for this path is not yet complete. |
| Original low-poly 3D model specs (`model3d`) | All Rights Reserved (unless stated) | PetitMaker | Original interpretations authored inline in the catalog JSON; game-referential where noted (see below). |
| Illustration samples (`src/assets/stylize/*.webp`, excluding `neural-*.webp`) | All Rights Reserved to the extent protectable; no separate reuse license granted | PetitMaker contributors, subject to provider and source rights | Project-generated examples used by the illustration studio. Provider terms and rights in the source map remain applicable. |
| On-device model weights and previews (`src/assets/stylize/models/*.onnx`, `src/assets/stylize/neural-*.webp`) | No separate reuse license granted; provenance review incomplete | PetitMaker contributors, subject to provider and source rights | Student models trained from provider-generated examples based on project map renders, plus previews generated by those models. They are product assets, not Apache-2.0 source code. Do not treat them as cleared for reuse; see the disclosure below. |

### Third-party assets & fonts

| Item | License | Owner | Notes |
|---|---|---|---|
| Alibaba PuHuiTi 3 (阿里巴巴普惠体 3.0), files `AlibabaPuHuiTi-*.woff2` | Alibaba PuHuiTi 3.0 statement | Alibaba (China) Co., Ltd. | Shipped as original, unmodified files because splitting or subsetting requires written authorization; see `THIRD_PARTY_NOTICES.md`. |
| Quicksand, files `Quicksand-*.woff2` | SIL Open Font License 1.1 | The Quicksand Project Authors | See `THIRD_PARTY_NOTICES.md`. |
| Team member avatars (`src/assets/team/`) | Publication permission under review; no reuse license granted | The individual members | Bilibili profile images displayed on the About screen. Each member's publication consent must be confirmed before release. |
| AI provider brand marks (`src/ui/agent/logos.tsx`) | Collection: MIT (Lobe Icons). Marks: each owner's trademark; no project license claimed | LobeHub (the collection); each provider (its own mark) | Shown beside the API-key field for identification. See the note below and `THIRD_PARTY_NOTICES.md` → Vendored assets. |

**AI provider brand marks.** The connection screen shows a platform's mark so a user can identify which service an API key belongs to. Every provider name and logo shown there is a trademark of its respective owner and appears for identification only. This project is not affiliated with, endorsed by, or sponsored by those providers, and displaying a mark does not claim a partnership or their support for this software.

The silhouettes are taken from the Lobe Icons collection, which is MIT licensed. That grant covers the collection; it does not and cannot convey rights in the marks themselves, which remain with each owner. Upstream says the same and recommends reviewing each brand's own trademark guidelines before bundling the marks into a product.

### User & game-referential material

| Item | Category | Notes |
|---|---|---|
| Maps a user creates/exports | User-provided | Rights held by the creator, subject to incorporated third-party material. |
| The README's sample map (`docs/media/share-map.png`, `share-map.zh.png`, and the figures drawn on it) | User-provided | 鱼松的爱心桃花岛, a map built in the editor by team member 鱼松 (credited in the README) and used here with the creator's permission. The map's rights stay theirs, subject to the in-game material it depicts. |
| Map templates (`src/config/maps/hexia.json`, `tafa.json`) | Game-derived | Layouts measured from in-game map/grid data (see disclosure below). |
| Path surface icons (`src/assets/icons/catalog/path-*.png`) | Game-derived | In-game path tile art shipped unmodified. Each file is both a picker icon and the texture drawn on the map. The copies came from the image library of the community-maintained [Petit Planet Wiki](https://petitplanet.wiki/), whose collection work we acknowledge. The wiki is not the artwork's rights holder; the art remains the game owner's and is not covered by the project-art terms above. |
| Neighbour portraits (`src/assets/neighbors/*-icon.png`) | Game-derived | In-game character portraits shipped unmodified as example inputs for picture generation. The copies came from the image library of the community-maintained [Petit Planet Wiki](https://petitplanet.wiki/), whose collection work we acknowledge. The wiki is not the artwork's rights holder; the art remains the game owner's and is not covered by the project-art terms above. |
| Item sprites and references drawn from the game | Redrawn-referential / game-derived | Classification depends on the file; game-referential material remains its owners'. |

## Game-Derived Material: Disclosure

Some material in this project is **game-derived**. The bundled map templates are measured from *Petit Planet* map and grid data; the `path-*.png` surfaces and neighbour portraits are the game's own art obtained through the community-maintained Petit Planet Wiki; and some catalog icons and `model3d` specs are original interpretations of in-game items.

A per-file provenance review is in progress, and some permission records remain unresolved. The review covers each asset's category, owner, source, permission basis, and review status. Until the relevant terms or permissions are confirmed, do not treat an unresolved asset as cleared for reuse.

**The audit summary is not itself a permission or license grant.** Documenting an asset's provenance records our investigation; it does **not** by itself authorize you (or us) to reuse, redistribute, or relicense that asset. Reuse rights come only from the applicable license or from a documented permission, never from the existence of an audit entry.

## How to request permission

If you would like to use our original art or brand, or to raise an intellectual-property concern (including a takedown request about game-referential material), contact us by email:

- **Email:** [selka.craft@outlook.com](mailto:selka.craft@outlook.com)
- **Subject prefix:** `[IP]`

Please include, so that we can act on your request:

1. **Which material** you mean: a file path (for example `src/assets/icons/catalog/bridge-suspension.png`) or a clear description.
2. **What use** you intend: where it will appear, whether it will be modified, and whether it will be redistributed.
3. **Who you are**: your name or organization and how to reach you.
4. If your message is a **takedown** or infringement claim, the right you hold and its basis, and a statement of your good-faith belief, matching the elements set out in the Intellectual-Property Complaints section of the [Terms of Use](/terms).

After we receive a complete request, we review IP requests and takedown notices in good faith, respond to the extent the request applies to material we actually control, and, for a well-founded takedown, remove or replace the material and tell you the outcome. If a request is unclear or incomplete, we may ask for the further detail we need before we can act. A grant of permission, when we give one, is in writing and is limited to the use we describe; silence is not permission.
