# Phase 20: Scalable Pet Catalog and Lightweight Picker Images

## Goal

Scale the public pet catalog and desktop Pet Manager beyond 1,000 pets without loading full spritesheets for every visible card.

The clean solution is to move lightweight preview generation into the `web/` catalog pipeline and have desktop consume paginated catalog metadata with small thumbnail assets.

## Non-goals

- Do not change Codex/local pet discovery, import, preview inlining, or `~/.codex/pets` behavior in this phase.
- Do not change installed pet runtime rendering; installed pets still use `spritesheet.webp` after install.
- Do not remove or break `catalog.v2.json`; keep it available for older desktop clients.
- Do not make the Electron renderer construct untrusted image URLs independently.
- Do not broaden desktop CSP beyond the exact image origins needed.

## Problem

The current desktop Pet Manager reads `catalog.v2.json`, then uses each pet's `preview` URL as a card preview. Today `web/scripts/*` writes `preview` as the full spritesheet:

```js
preview: `${PUBLIC_BASE_URL}${pet.spritesheetPath}`
```

That means the picker can request hundreds or thousands of full files like:

```text
https://openpets.dev/pets/<slug>/spritesheet.webp
```

With a 1,000+ pet catalog, this creates excessive network, decode, memory, and layout work. Desktop-side lazy loading helps, but it does not solve the root issue: gallery cards need tiny thumbnails, not full runtime spritesheets.

## Desired outcome

- Public catalog supports 1,000+ pets without a huge single JSON payload.
- Pet Manager initially loads only a small page of metadata and small thumbnails.
- Full spritesheets are fetched only when needed for install/runtime or, optionally, selected-pet detail preview.
- Pet Manager keeps existing filters, including `Codex`, and adds the same high-level public catalog filters already used on the web: `Western` and `Asian`.
- Existing desktop clients can continue using `catalog.v2.json`.
- Codex/local pet behavior remains unchanged.

## Proposed asset model

For every public catalog pet under `web/public/pets/<slug>/`, generate and publish:

```text
spritesheet.webp  # existing full runtime/install asset
thumb.webp        # new tiny static thumbnail for gallery cards
preview.webp      # optional small animated/detail preview, if cheap to generate
<petId>.zip       # existing install package, served from zip.openpets.dev
```

Recommended budgets:

- `thumb.webp`: 96-160px static image, target < 10-20 KB.
- `preview.webp`: optional short idle animation or selected-detail image, target < 50-100 KB.
- `spritesheet.webp`: unchanged; used for installs/runtime, not bulk gallery cards.

If `preview.webp` is not generated in the first implementation, desktop can use `thumbnail` in cards and reserve `spritesheet` only for selected detail/install paths.

## Proposed catalog model

Keep `public/pets/catalog.v2.json` unchanged for compatibility.

Add `public/pets/catalog.v3.json` as an index:

```json
{
  "version": 3,
  "generatedAt": "2026-05-12T00:00:00.000Z",
  "total": 2500,
  "pageSize": 100,
  "filters": {
    "categories": [
      { "id": "western", "label": "Western", "count": 1250 },
      { "id": "asian", "label": "Asian", "count": 1250 }
    ]
  },
  "pages": [
    "https://openpets.dev/pets/catalog.v3/page-000.json",
    "https://openpets.dev/pets/catalog.v3/page-001.json"
  ]
}
```

Add paginated page files under `public/pets/catalog.v3/`:

```json
{
  "version": 3,
  "page": 0,
  "pageSize": 100,
  "pets": [
    {
      "id": "snoopy",
      "displayName": "Snoopy",
      "description": "A tiny black-and-white beagle with a red collar for calm coding sessions.",
      "thumbnail": "https://openpets.dev/pets/snoopy-23e05847/thumb.webp",
      "preview": "https://openpets.dev/pets/snoopy-23e05847/preview.webp",
      "spritesheet": "https://openpets.dev/pets/snoopy-23e05847/spritesheet.webp",
      "zip": "https://zip.openpets.dev/pets/snoopy-23e05847/snoopy.zip",
      "category": "western",
      "subcategory": "cartoons"
    }
  ]
}
```

Fields:

- `thumbnail`: required for v3 catalog pets.
- `preview`: optional; desktop must tolerate missing/failed preview.
- `spritesheet`: optional for gallery use, but useful for detail/runtime preview if explicitly selected.
- `zip`: required for installation.
- `category`: required for v3 public catalog pets and currently limited to `western` or `asian`.
- `subcategory`: optional; preserve existing web metadata where present.

V3 index invariants:

- Maximum index response size: 256 KB.
- Maximum page response size: 256 KB.
- Default page size: 100 pets.
- Maximum page size: 200 pets.
- Maximum page count: 100 pages for this phase.
- `total` must equal the sum of pets across all pages during generation.
- Pet IDs must be unique across all pages.
- Page URLs must match `https://openpets.dev/pets/catalog.v3/page-<3 digit>.json`.
- Deploy ordering must publish page files before publishing the index that references them.

## Public catalog filters

The web app already groups public pets into two top-level filters: `Western` and `Asian`. V3 should carry this as canonical metadata so desktop does not infer categories from names, slugs, descriptions, or paths.

Filter contract:

- `category` is required for every v3 public catalog pet.
- Allowed initial values are exactly:
  - `western`
  - `asian`
- Desktop labels these as `Western` and `Asian`.
- Desktop keeps existing filters and adds category filters: `All`, `Installed`, `Codex`, `Western`, and `Asian`.
- `Codex` filter behavior must stay unchanged from the current Pet Manager.
- If a v3 pet has a missing/unknown category, validation should reject the page or mark the pet unavailable rather than guessing.
- v2 fallback does not provide reliable category filtering; when using v2 fallback, desktop should hide `Western`/`Asian` filters or show them disabled.
- Codex/local-only pets are not part of this category filter contract in this phase. If shown in the same grid, they continue to appear under the existing `Codex` filter and under `All`/`Installed` when applicable, but not under `Western`/`Asian` unless they correspond to a catalog pet with v3 category metadata.

Category source rules:

- `web/scripts/import-reviewed-pets.js` already validates reviewed-pet `category`; v3 must preserve it.
- `web/scripts/sync-pets.js` must preserve category from an existing manifest entry when present.
- `web/scripts/sync-local-pets.js` must preserve category from the existing generated/manifest entry when present.
- Any pet still missing `western`/`asian` after preservation is excluded from v3 and logged, while v2 remains unchanged for compatibility.
- Generation must not infer category from names, slugs, descriptions, upstream source, or folder paths.

## Web implementation plan

Update all public catalog writers that currently emit `catalog.v2.json`:

- `web/scripts/sync-pets.js`
- `web/scripts/import-reviewed-pets.js`
- `web/scripts/sync-local-pets.js`

Tasks:

1. Add shared helpers for catalog asset paths and v3 output shape.
2. Generate `thumb.webp` for each public catalog pet if missing or stale.
3. Optionally generate `preview.webp` after `thumb.webp` is stable.
4. Continue writing `catalog.v2.json` as a backward-compatible subset if the public catalog grows beyond the existing v2 desktop validation limit.
5. Write `catalog.v3.json` plus `catalog.v3/page-XXX.json` files.
6. Keep zip URLs on `zip.openpets.dev` unchanged.
7. Include the existing web category metadata in every v3 pet as `category: "western" | "asian"`.
8. Add validation that every v3 page item has safe `id`, `thumbnail`, `zip`, and known `category` fields.
9. Add category counts to the v3 index so desktop can show correct filters before every page is loaded.

Thumbnail generation options:

- Preferred: use `sharp` in the web workspace to crop/extract the universal spritesheet idle first frame from the 8-column by 9-row spritesheet and resize to a small static WebP.
- Fallback: if sprite-frame extraction is unreliable for a pet, create a small resized/cropped static thumbnail from the top-left/idle frame area and log the fallback.
- Stale detection should compare `thumb.webp` mtime to `spritesheet.webp`; regenerate when the spritesheet is newer.
- Generation should fail or loudly warn if thumbnails exceed the agreed byte/dimension budget.

## Desktop implementation plan

Add a new desktop catalog path while keeping v2 fallback:

1. Fetch `https://openpets.dev/pets/catalog.v3.json` first.
2. Validate the index response size and exact final URL.
3. Fetch the first page only on initial Pet Manager open.
4. Load additional pages on scroll, explicit "Load more", or search pagination.
5. Render card images from `thumbnail`, not `preview`/`spritesheet`.
6. Preserve the existing `Codex` filter and add category filters: `All`, `Installed`, `Codex`, `Western`, and `Asian`.
7. Apply `Western`/`Asian` filters using validated v3 `category` metadata only.
8. Use `preview` only for selected-pet detail if available and cheap.
9. Use `spritesheet` only for selected-pet detail preview if explicitly needed; never for every card.
10. Fall back to v2 when v3 is unavailable.
11. Keep all remote image URLs main-process validated before exposing them to preload.

Main-process data contract:

- Add a paged v3 catalog UI state instead of requiring preload to know remote page URLs.
- Main process owns index/page fetch, validation, caching, and install lookup.
- `installPet(id)` must be able to resolve validated v3 metadata for pets outside page 0 by using a main-process cache or by fetching the needed validated page/index data.
- Installed catalog pets that are not in the first loaded page must still retain usable installed-state rows; detail/category/thumbnail can be enriched as pages load.

Renderer behavior:

- Do not render 1,000 cards at once; use paging or virtualization.
- Start with explicit paging/"Load more"; virtualization can be added later if needed.
- Limit concurrent remote image loads.
- Use async decoding and no referrer.
- Keep graceful empty/failure surfaces for thumbnail load errors.
- If only a thumbnail is available for a catalog pet, do not show fake animated mini state previews. Either fetch a selected-detail preview/spritesheet on selection or hide/degrade mini state previews for that pet.
- Do not change Codex/local pet rendering or import behavior in this phase.

## Security and compatibility notes

- Desktop CSP should continue to allow only `data:` and `https://openpets.dev` for Pet Manager images unless the implementation requires a narrower path/origin rule.
- The renderer must not independently derive `thumbnail`, `preview`, `spritesheet`, or `zip` URLs.
- Main process should validate:
  - catalog index final URL,
  - page URL origin/path,
  - thumbnail/preview/spritesheet origin/path/extension,
  - zip origin/path/extension.
- `catalog.v2.json` remains the compatibility contract for currently shipped clients.
- If the total public catalog exceeds the current v2 validator's limit, `catalog.v2.json` should remain capped to a compatible curated subset rather than silently breaking shipped clients.
- `catalog.v3` can be rolled out on the web before desktop starts consuming it.

## Rollout plan

1. Web-only rollout:
   - Generate `thumb.webp` assets.
   - Publish `catalog.v3` alongside existing v2.
   - Verify URLs and asset sizes on production.
2. Desktop fallback support:
   - Add v3 fetch/validation with v2 fallback.
   - Keep existing Pet Manager behavior if v3 is missing.
3. Desktop performance update:
   - Switch cards to `thumbnail`.
   - Add paging/virtualization and bounded image loading.
4. Cleanup/observability:
   - Add size checks to web sync scripts.
   - Add desktop contract tests for v3 validation and fallback.

## Acceptance criteria

- `catalog.v2.json` output remains backward compatible.
- `catalog.v3.json` and page files are generated by all relevant web catalog sync/import flows.
- Every v3 pet has a small `thumbnail` URL under `https://openpets.dev/pets/` ending in `.webp`.
- Desktop Pet Manager card grid uses `thumbnail` for catalog pets.
- Desktop Pet Manager includes `All`, `Installed`, existing `Codex`, `Western`, and `Asian` filters when v3 metadata is available.
- `Codex` filter behavior is unchanged.
- `Western`/`Asian` filters are driven only by validated v3 `category` metadata.
- If desktop falls back to v2, `Western`/`Asian` filters are hidden or disabled because v2 does not guarantee category metadata.
- Opening Pet Manager with 1,000+ catalog pets does not request all full `spritesheet.webp` files.
- Initial Pet Manager open requests only the v3 index, first page, and thumbnails for rendered/visible cards.
- Full `spritesheet.webp` files are requested only for selected detail preview if explicitly implemented, install packages, or runtime installed pets.
- v3 outage or validation failure falls back to v2 without breaking install/default/remove operations.
- `catalog.v2.json` remains within the compatibility limit expected by shipped desktop clients.
- Codex/local pet behavior is unchanged.
- Web generation validates unique v3 IDs, category counts, page URLs, response-size budgets, and thumbnail existence.

## Test/check plan

Web:

```bash
cd web
bun lint
bun run build
bun run sync:pets
```

Desktop:

```bash
pnpm --filter @open-pets/desktop build
pnpm --filter @open-pets/desktop test
pnpm package:desktop:dir
```

Manual verification:

1. Publish or locally serve a v3 catalog with at least 1,000 pets.
2. Open desktop Pet Manager.
3. Confirm only index/page JSON and card thumbnails are loaded initially.
4. Scroll/load more and confirm requests grow by page/viewport, not by total catalog size.
5. Switch between `All`, `Installed`, `Codex`, `Western`, and `Asian`; confirm Codex remains unchanged and category filters match web categories.
6. Select a pet and confirm detail still works.
7. Install a pet and confirm runtime installed pet behavior is unchanged.
8. Disable v3 and confirm v2 fallback works with category filters hidden/disabled.
9. Confirm Codex/local pets behave exactly as before.

## Open questions

- Should `preview.webp` ship in the first implementation, or should v3 start with only `thumbnail` plus existing `spritesheet`?
- Should desktop search initially search loaded pages only with explicit copy, or should the web publish a lightweight searchable index in the same phase?
