# Asset Licenses & Provenance

**At a glance:** this repository mixes materials under different terms. **Code is Apache-2.0. The brand, logo, and original art are All Rights Reserved unless stated otherwise. Third-party assets and fonts keep their own licenses. User-created maps belong to their creators.** Do not assume that because the code is open source, the art, brand, or any game-referential material is free to reuse. This document is the map of who owns what; it is a provenance record, **not** a grant of permission.

PetitMaker, whose Chinese name is 谷地工坊, is an independent, unofficial fan project. It is **not affiliated** with, endorsed by, or sponsored by miHoYo / HoYoverse (COGNOSPHERE PTE. LTD.). *Petit Planet*, whose Chinese name is 星布谷地, and related names, characters, and material are the property of their respective owners.

## Scope split

The repository contains four distinct classes of material, each under its own terms:

1. **Code**: the application source (`src/`, the build/legal tooling under `scripts/`, and configuration). Licensed **Apache-2.0** (see `LICENSE` and `NOTICE`). Inbound contributions are under the same license (see `CONTRIBUTING.md`).
2. **Brand, logo, and original art**: the PetitMaker name and logo, and original artwork created for the project. Examples include the catalog item sprites under `src/assets/icons/catalog/` and the UI chrome icons under `src/assets/icons/ui/`, and the original low-poly 3D model specifications (`model3d`) authored in the catalog JSON. These are **All Rights Reserved** unless a specific file or section states otherwise. They are **not** covered by the code's Apache-2.0 license. The project's original art is led by **火山野牛王**. (Sharing your own editor exports that embed this art is expressly permitted; see [Sharing what you export](#sharing-what-you-export).)
3. **Third-party assets and fonts**: third-party materials keep **their own licenses**; nothing here overrides or relicenses them. Bundled software dependencies are recorded in `THIRD_PARTY_NOTICES.md`; the shipped fonts (Alibaba PuHuiTi 3 and Quicksand), together with their exact license texts and subsetting findings, are recorded in the **Fonts** section of `THIRD_PARTY_NOTICES.md`; refer to that section rather than this file for font terms.
4. **User maps**: the **User maps** and other content a user creates in the editor are the rights of their respective creators, subject to any third-party material they incorporate (game-referential names, templates, or assets remain their owners'). For the images and files you export and share, see [Sharing what you export](#sharing-what-you-export).

## Sharing what you export

The images and files the editor produces for you (screenshots, exported map files, share images including the PetitGlyph code band, and 3D preview captures) necessarily embed artwork from classes 2 and 3 above alongside your own map design: a map is drawn with item sprites, and a share card carries project art. So that the ownership split above never contradicts the tool's purpose:

- **You may share your exports.** We grant every user a non-exclusive, royalty-free, worldwide permission to publish, display, and share the images and files this editor exports of their own maps, including the PetitMaker brand elements and original artwork embedded in them, in any medium. The class-2 "All Rights Reserved" restricts standalone reuse of the art (extracting sprites, redistributing the icon set, using the name or logo elsewhere), **not** the sharing of your exports.
- **This permission does not cover extraction.** Cropping, extracting, or reproducing embedded artwork for use outside the context of sharing your own map is reuse of the underlying asset and requires its own permission (see [How to request permission](#how-to-request-permission)).
- **Game-referential material remains its owners'.** Where embedded material references *Petit Planet*, your sharing of it remains subject to the game owner's own terms and fan-content policies. We can only grant rights to what we hold; we cannot and do not grant rights on the game owner's behalf.
- **No transfer, no endorsement.** This permission is the same for every user, does not transfer ownership of any embedded material, and does not make an export official game content or content endorsed by us or by the game's publisher.

## Ownership matrix

### Code

| Item | License | Owner | Notes |
|---|---|---|---|
| Application source (`src/`, build scripts, config) | Apache-2.0 | PetitMaker contributors | See `LICENSE` / `NOTICE`; contributors retain copyright and license inbound=outbound. |
| Bundled software dependencies | Their own licenses | Upstream authors | Enumerated in `THIRD_PARTY_NOTICES.md`; full texts under `licenses/<pkg>/`. |

### Brand & original art

| Item | License | Owner | Notes |
|---|---|---|---|
| PetitMaker name and logo | All Rights Reserved | PetitMaker | Not licensed under Apache-2.0. |
| Catalog item sprites (`src/assets/icons/catalog/`) | All Rights Reserved (unless stated) | 火山野牛王 / PetitMaker | The per-item icons across the seven catalog families (Building, Tree, Flora, Road, Bridge, Ramp, Facility; e.g. `building-bamboo-cabin.png`, `bridge-suspension.png`); game-referential where noted (see disclosure below). The 25 `path-*.png` files are the exception: they are game-derived, not original art, and are listed in the table below. |
| UI chrome icons (`src/assets/icons/ui/`) | All Rights Reserved (unless stated) | 火山野牛王 / PetitMaker | Interface art: tool, brush, and control glyphs (e.g. `brush-circle.png`, `dice.png`). Created for the project. |
| Original low-poly 3D model specs (`model3d`) | All Rights Reserved (unless stated) | PetitMaker | Original interpretations authored inline in the catalog JSON; game-referential where noted (see below). |

### Third-party assets & fonts

| Item | License | Owner | Notes |
|---|---|---|---|
| Alibaba PuHuiTi 3 (阿里巴巴普惠体 3.0), files `AlibabaPuHuiTi-*.woff2` | Alibaba PuHuiTi 3.0 statement | Alibaba (China) Co., Ltd. | Shipped as original, unmodified files (subsetting not clearly permitted); see `THIRD_PARTY_NOTICES.md`. |
| Quicksand, files `Quicksand-*.woff2` | SIL Open Font License 1.1 | The Quicksand Project Authors | See `THIRD_PARTY_NOTICES.md`. |
| Team member avatars (`src/assets/team/`) | Used with member consent | The individual members | Bundled Bilibili avatars shown on the About screen, scoped to each member's consent; not licensed for other use. |
| AI provider brand marks (`src/ui/agent/logos.tsx`) | Collection: MIT (Lobe Icons). Marks: nominative trademark use, unlicensed | LobeHub (the collection); each provider (its own mark) | Shown beside the API-key field so a user can see which platform a key belongs to. See the note below and `THIRD_PARTY_NOTICES.md` → Vendored assets. |

**AI provider brand marks.** Connecting the agent means pasting your own API key, and the key screen
shows each supported platform's mark so you can tell which one a key belongs to. Anthropic, OpenAI,
Google, DeepSeek, Zhipu, Alibaba, Moonshot, OpenRouter and Perplexity, together with their names and
logos, are trademarks of their respective owners. They appear here for identification only. This project is not
affiliated with, endorsed by, or sponsored by any of them, and displaying a mark is not a claim of
partnership or of support for this software.

The silhouettes are taken from the Lobe Icons collection, which is MIT licensed. That grant covers
the collection; it does not and cannot convey rights in the marks themselves, which remain with each
owner. Upstream says the same and recommends reviewing each brand's own trademark guidelines before
bundling the marks into a product.

### User & game-referential material

| Item | Category | Notes |
|---|---|---|
| Maps a user creates/exports | User-provided | Rights held by the creator, subject to incorporated third-party material. |
| The README's sample map (`docs/media/share-map.png`, `share-map.zh.png`, and the figures drawn on it) | User-provided | 鱼松的爱心桃花岛, a map built in the editor by team member 鱼松 (credited in the README) and shipped as the README's importable share image; the map's rights stay theirs, subject to the in-game material it depicts, and the permission record is kept in the internal audit like every class-4 entry. |
| Map templates (`src/config/maps/hexia.json`, `tafa.json`) | Game-derived | Layouts measured from in-game map/grid data (see disclosure below). |
| Path surface icons (`src/assets/icons/catalog/path-*.png`, 25 files) | Game-derived | The in-game path tile art, shipped unmodified. Each file is both the road picker's icon and the texture the map draws that surface with, so the editor shows the surface a player would actually lay. The files were obtained from the image library of the community-maintained [Petit Planet Wiki](https://petitplanet.wiki/) (petitplanet.wiki), which hosts the game's unpacked assets; we acknowledge the wiki's collection work with thanks. The wiki is the source of the copies, not a rights holder in the artwork: the art is the game owner's, it is not original art, and it is not covered by the class-2 terms above (see disclosure below). |
| Neighbour portraits (`src/assets/neighbors/*-icon.png`, 14 files) | Game-derived | The in-game character portrait icons, shipped unmodified. The generate shelf deals them as the example pictures a map can be built from, so the picture mode can be tried without a file on hand. Obtained from the image library of the community-maintained [Petit Planet Wiki](https://petitplanet.wiki/) (petitplanet.wiki), with thanks for its collection work; as with the path tiles, the wiki is the source of the copies and not a rights holder in the artwork, which is the game owner's and is not covered by the class-2 terms above (see disclosure below). |
| Item sprites & references drawn from the game | Redrawn-referential / game-derived | Determined per file in the internal audit; game-referential material remains its owners'. |

## Game-Derived Material: Disclosure

Some material in this project is **game-derived**: for example, the bundled map templates (`hexia.json`, `tafa.json`) are measured from *Petit Planet* in-game map/grid data, the 25 `path-*.png` surface icons and the 14 `src/assets/neighbors/*-icon.png` character portraits are the game's own art (both obtained via the community-maintained Petit Planet Wiki, per the table above), and certain catalog icons and `model3d` specs are original interpretations that reference in-game items.

A per-file provenance **audit is in progress**. Its detailed ledger, which records each asset's category, owner, source, permission basis, and reviewer, is maintained **internally** and is not part of the public repository. This public document carries only the summary posture, so a reader can see what kind of material is present and how it is treated.

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
