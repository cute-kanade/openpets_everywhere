import { readFile } from "node:fs/promises";

import { validateCatalogV2, validateCatalogV3Index, validateCatalogV3Page } from "./catalog-validation.js";

const fixture = JSON.parse(await readFile("catalog.v2.fixture.json", "utf8")) as unknown;
validateCatalogV2(fixture);

const invalidCases: readonly unknown[] = [
  { version: 2, generatedAt: new Date().toISOString(), pets: [{ id: "Bad ID", displayName: "Bad", description: "", preview: "https://openpets.dev/pets/x/spritesheet.webp", zip: "https://zip.openpets.dev/pets/x/x.zip" }] },
  { version: 2, generatedAt: new Date().toISOString(), pets: [{ id: "dup", displayName: "Dup", description: "", preview: "https://openpets.dev/pets/x/spritesheet.webp", zip: "https://zip.openpets.dev/pets/x/x.zip" }, { id: "dup", displayName: "Dup 2", description: "", preview: "https://openpets.dev/pets/y/spritesheet.webp", zip: "https://zip.openpets.dev/pets/y/y.zip" }] },
  { version: 2, generatedAt: new Date().toISOString(), pets: [{ id: "http", displayName: "Http", description: "", preview: "http://openpets.dev/pets/x/spritesheet.webp", zip: "https://zip.openpets.dev/pets/x/x.zip" }] },
  { version: 2, generatedAt: new Date().toISOString(), pets: [{ id: "host", displayName: "Host", description: "", preview: "https://evil.example/pets/x/spritesheet.webp", zip: "https://zip.openpets.dev/pets/x/x.zip" }] },
  { version: 2, generatedAt: new Date().toISOString(), pets: [{ id: "builtin", displayName: "Builtin", description: "", preview: "https://openpets.dev/pets/x/spritesheet.webp", zip: "https://zip.openpets.dev/pets/x/x.zip" }] },
];

for (const invalidCase of invalidCases) {
  assertRejectsCatalog(invalidCase);
}

const v3Index = validateCatalogV3Index({
  version: 3,
  generatedAt: new Date().toISOString(),
  total: 1,
  pageSize: 100,
  filters: { categories: [{ id: "western", label: "Western", count: 1 }, { id: "asian", label: "Asian", count: 0 }] },
  pages: ["https://openpets.dev/pets/catalog.v3/page-000.json"],
});

validateCatalogV3Page({
  version: 3,
  generatedAt: v3Index.generatedAt,
  page: 0,
  pageSize: 100,
  pets: [{
    id: "snoopy",
    displayName: "Snoopy",
    description: "A tiny beagle.",
    thumbnail: "https://openpets.dev/pets/snoopy-23e05847/thumb.webp",
    spritesheet: "https://openpets.dev/pets/snoopy-23e05847/spritesheet.webp",
    zip: "https://zip.openpets.dev/pets/snoopy-23e05847/snoopy.zip",
    category: "western",
    subcategory: "cartoons",
  }],
}, 0, 100);

assertRejectsCatalogV3Page({
  version: 3,
  generatedAt: new Date().toISOString(),
  page: 0,
  pageSize: 100,
  pets: [{ id: "bad", displayName: "Bad", description: "", thumbnail: "https://openpets.dev/pets/bad/spritesheet.png", zip: "https://zip.openpets.dev/pets/bad/bad.zip", category: "western" }],
});

assertRejectsCatalogV3Page({
  version: 3,
  generatedAt: new Date().toISOString(),
  page: 0,
  pageSize: 100,
  pets: [{ id: "bad", displayName: "Bad", description: "", thumbnail: "https://openpets.dev/pets/bad/thumb.webp", zip: "https://zip.openpets.dev/pets/bad/bad.zip", category: "unknown" }],
});

console.log("Catalog fixture validation passed.");

function assertRejectsCatalog(value: unknown): void {
  try {
    validateCatalogV2(value);
  } catch {
    return;
  }

  throw new Error("Invalid catalog fixture case was accepted.");
}

function assertRejectsCatalogV3Page(value: unknown): void {
  try {
    validateCatalogV3Page(value, 0, 100);
  } catch {
    return;
  }

  throw new Error("Invalid catalog v3 page case was accepted.");
}
