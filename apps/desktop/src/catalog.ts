import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import { validateCatalogV2, validateCatalogV3Index, validateCatalogV3Page, type CatalogPetV2, type CatalogPetV3, type CatalogV2, type CatalogV3Index, type CatalogV3Page } from "./catalog-validation.js";

export const catalogUrl = "https://openpets.dev/pets/catalog.v2.json";
export const catalogV3Url = "https://openpets.dev/pets/catalog.v3.json";
const fixtureRelativePath = "catalog.v2.fixture.json";
const maxCatalogBytes = 1_000_000;
const maxCatalogV3IndexBytes = 256 * 1024;
const maxCatalogV3PageBytes = 256 * 1024;
const fetchTimeoutMs = 5_000;

export interface CatalogUiState {
  readonly source: "remote" | "fixture" | "error";
  readonly version: 2 | 3;
  readonly pets: readonly CatalogUiPet[];
  readonly generatedAt?: string;
  readonly error?: string;
  readonly v3?: CatalogV3UiState;
}

export type CatalogUiPet = CatalogPetV2 | CatalogPetV3;

export interface CatalogV3UiState {
  readonly total: number;
  readonly pageSize: number;
  readonly loadedPages: readonly number[];
  readonly hasMore: boolean;
  readonly filters: CatalogV3Index["filters"];
}

const v3PageCache = new Map<number, CatalogV3Page>();
let v3IndexCache: CatalogV3Index | null = null;

export async function getCatalogUiState(): Promise<CatalogUiState> {
  const v3 = await tryLoadRemoteCatalogV3FirstPage();

  if (v3.ok) {
    const loadedPages = [...new Set([...v3PageCache.keys()])].sort((left, right) => left - right);
    const pets = loadedPages.flatMap((loadedPage) => v3PageCache.get(loadedPage)?.pets ?? []);
    return {
      source: "remote",
      version: 3,
      pets,
      generatedAt: v3.index.generatedAt,
      v3: {
        total: v3.index.total,
        pageSize: v3.index.pageSize,
        loadedPages,
        hasMore: loadedPages.length < v3.index.pages.length,
        filters: v3.index.filters,
      },
    };
  }

  const remote = await tryLoadRemoteCatalog();

  if (remote.ok) {
    return {
      source: "remote",
      version: 2,
      pets: remote.catalog.pets,
      generatedAt: remote.catalog.generatedAt,
      error: `Catalog v3 unavailable: ${v3.error}`,
    };
  }

  const fixture = await tryLoadFixtureCatalog();

  if (fixture.ok) {
    return {
      source: "fixture",
      version: 2,
      pets: fixture.catalog.pets,
      generatedAt: fixture.catalog.generatedAt,
      error: `Catalog v3 unavailable: ${v3.error}. Live catalog unavailable: ${remote.error}`,
    };
  }

  return {
    source: "error",
    version: 2,
    pets: [],
    error: `Catalog v3 unavailable: ${v3.error}. Live catalog unavailable: ${remote.error}. Fixture unavailable: ${fixture.error}`,
  };
}

export async function getCatalogPageUiState(pageIndex: number): Promise<CatalogUiState> {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new Error("Catalog page index is invalid.");
  const index = await getCatalogV3Index();
  const page = await getCatalogV3Page(index, pageIndex);
  const loadedPages = [...new Set([...v3PageCache.keys()])].sort((left, right) => left - right);
  const pets = loadedPages.flatMap((loadedPage) => v3PageCache.get(loadedPage)?.pets ?? []);
  return {
    source: "remote",
    version: 3,
    pets,
    generatedAt: index.generatedAt,
    v3: {
      total: index.total,
      pageSize: index.pageSize,
      loadedPages,
      hasMore: loadedPages.length < index.pages.length,
      filters: index.filters,
    },
  };
}

export async function getCatalogPetById(petId: string): Promise<CatalogUiPet> {
  const v3 = await tryLoadRemoteCatalogV3FirstPage();
  if (v3.ok) {
    const cached = findCachedV3Pet(petId);
    if (cached) return cached;
    try {
      for (let pageIndex = 0; pageIndex < v3.index.pages.length; pageIndex += 1) {
        const page = await getCatalogV3Page(v3.index, pageIndex);
        const pet = page.pets.find((candidate) => candidate.id === petId);
        if (pet) return pet;
      }
    } catch {
      // Fall back to the compatibility catalog if any later v3 page is unavailable or invalid.
    }
  }
  const remote = await tryLoadRemoteCatalog();
  const fixture = remote.ok ? null : await tryLoadFixtureCatalog();
  const fallback = remote.ok ? remote.catalog : fixture?.ok ? fixture.catalog : null;
  const pet = fallback?.pets.find((candidate) => candidate.id === petId);
  if (!pet) throw new Error(`Pet is not available in the validated catalog: ${petId}`);
  return pet;
}

async function tryLoadRemoteCatalog(): Promise<{ readonly ok: true; readonly catalog: CatalogV2 } | { readonly ok: false; readonly error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const response = await fetch(catalogUrl, {
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
    });

    validateCatalogEndpoint(response.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await readLimitedResponse(response);
    return { ok: true, catalog: validateCatalogV2(JSON.parse(text) as unknown) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  } finally {
    clearTimeout(timeout);
  }
}

async function tryLoadRemoteCatalogV3FirstPage(): Promise<{ readonly ok: true; readonly index: CatalogV3Index; readonly page: CatalogV3Page } | { readonly ok: false; readonly error: string }> {
  try {
    const index = await getCatalogV3Index();
    const page = await getCatalogV3Page(index, 0);
    return { ok: true, index, page };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function getCatalogV3Index(): Promise<CatalogV3Index> {
  if (v3IndexCache) return v3IndexCache;
  const response = await fetchBounded(catalogV3Url, maxCatalogV3IndexBytes);
  validateCatalogV3IndexEndpoint(response.url);
  v3IndexCache = validateCatalogV3Index(JSON.parse(response.text) as unknown);
  return v3IndexCache;
}

async function getCatalogV3Page(index: CatalogV3Index, pageIndex: number): Promise<CatalogV3Page> {
  const cached = v3PageCache.get(pageIndex);
  if (cached) return cached;
  const pageUrl = index.pages[pageIndex];
  if (!pageUrl) throw new Error(`Catalog page is unavailable: ${pageIndex}`);
  const response = await fetchBounded(pageUrl, maxCatalogV3PageBytes);
  if (response.url !== pageUrl) throw new Error("Catalog page final URL changed.");
  const page = validateCatalogV3Page(JSON.parse(response.text) as unknown, pageIndex, index.pageSize);
  for (const cachedPage of v3PageCache.values()) {
    for (const pet of page.pets) {
      if (cachedPage.pets.some((cachedPet) => cachedPet.id === pet.id)) throw new Error(`Duplicate catalog v3 pet id across pages: ${pet.id}`);
    }
  }
  v3PageCache.set(pageIndex, page);
  return page;
}

async function fetchBounded(url: string, maxBytes: number): Promise<{ readonly url: string; readonly text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error", credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { url: response.url, text: await readLimitedResponse(response, maxBytes) };
  } finally {
    clearTimeout(timeout);
  }
}

async function tryLoadFixtureCatalog(): Promise<{ readonly ok: true; readonly catalog: CatalogV2 } | { readonly ok: false; readonly error: string }> {
  try {
    return { ok: true, catalog: validateCatalogV2(await loadFixtureCatalog()) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function loadFixtureCatalog(): Promise<unknown> {
  const fixturePath = join(app.getAppPath(), fixtureRelativePath);
  return JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
}

async function readLimitedResponse(response: Response, maxBytes = maxCatalogBytes): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Catalog response body is unavailable for bounded reading.");

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error("Catalog response is too large.");
    chunks.push(value);
  }

  return new TextDecoder().decode(concatChunks(chunks, total));
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function validateCatalogEndpoint(value: string): void {
  const url = new URL(value);
  if (url.href !== catalogUrl) throw new Error("Catalog final URL is not allowed.");
}

function validateCatalogV3IndexEndpoint(value: string): void {
  const url = new URL(value);
  if (url.href !== catalogV3Url) throw new Error("Catalog v3 final URL is not allowed.");
}

function findCachedV3Pet(petId: string): CatalogPetV3 | undefined {
  for (const page of v3PageCache.values()) {
    const pet = page.pets.find((candidate) => candidate.id === petId);
    if (pet) return pet;
  }
  return undefined;
}
