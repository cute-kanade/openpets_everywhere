import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import logoUrl from "../../../assets/onboarding-logo.webp";
import defaultThumbUrl from "../../../assets/default-pet-thumbnail.png";

const api = (window as unknown as { openPetsControlCenter: { getPetsState(): Promise<StateSnapshot>; getCatalog(): Promise<CatalogState>; getCatalogPage(page: number): Promise<CatalogState>; getCatalogSearch(): Promise<{ pets: SearchPetEntry[]; error?: string }>; getCodexPets(): Promise<CodexState>; setDefaultPet(petId: string): Promise<StateSnapshot>; installPet(petId: string): Promise<unknown>; importCodexPet(petId: string): Promise<unknown>; removePet(petId: string): Promise<StateSnapshot> } }).openPetsControlCenter;
type Filter = "all" | "installed" | "original" | "western" | "asian" | "codex";
type InstalledPet = { id: string; displayName: string; description?: string; builtIn: boolean; protected: boolean; installed: boolean; broken?: boolean; brokenReason?: string; source?: { kind?: "catalog"; preview?: string } | { kind: "codex"; path: string } };
type PetEntry = { id: string; displayName: string; description?: string; searchText?: string; preview?: string; spritesheet?: string; category?: "western" | "asian"; original?: boolean; featured?: boolean; sourceKind?: "installed" | "catalog" | "codex"; installed?: boolean; builtIn?: boolean; protected?: boolean; broken?: boolean; brokenReason?: string };
type SearchPetEntry = Pick<PetEntry, "id" | "displayName" | "category" | "original" | "featured"> & { searchText?: string; catalogPage?: number };
type StateSnapshot = { preferences: { defaultPetId: string }; pets: { installed: InstalledPet[] } };
type CatalogState = { pets: PetEntry[]; source: string; error?: string; page?: number; pageCount?: number; total?: number; categories?: { id: "western" | "asian"; label: string; count: number }[]; originalsCount?: number };
type CodexState = { pets: PetEntry[]; error?: string };


function Button({ children, variant = "primary", onClick, disabled }: { children: React.ReactNode; variant?: "primary" | "secondary" | "danger"; onClick?: () => void; disabled?: boolean }) {
  return <button className={`btn btn-${variant}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <section className={`glass ${className}`}>{children}</section>; }
function StatusPill({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "green" | "orange" | "red" | "slate" }) { return <span className={`pill pill-${tone}`}>{children}</span>; }
function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input className="search" placeholder="Search pets..." {...props} />; }

function App() {
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [catalogPages, setCatalogPages] = useState<Record<number, PetEntry[]>>({});
  const [catalogSearch, setCatalogSearch] = useState<SearchPetEntry[] | null>(null);
  const [catalogPage, setCatalogPage] = useState(0);
  const [codex, setCodex] = useState<CodexState>({ pets: [] });
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const [nextState, nextCatalog, nextCodex] = await Promise.all([api.getPetsState(), api.getCatalog(), api.getCodexPets()]);
    setState(nextState); setCatalog(nextCatalog); setCodex(nextCodex);
    setCatalogPage(nextCatalog.page ?? 0);
    setCatalogPages({ [nextCatalog.page ?? 0]: nextCatalog.pets });
    setSelectedId((current) => current || nextState.preferences.defaultPetId || nextState.pets.installed[0]?.id || nextCatalog.pets[0]?.id || "");
  }
  useEffect(() => { void load().catch((err) => setError(String(err?.message ?? err))); }, []);

  const pets = useMemo(() => {
    const installed = new Map((state?.pets.installed ?? []).map((p) => [p.id, p]));
    const byId = new Map<string, PetEntry>();
    const rows: PetEntry[] = (state?.pets.installed ?? []).map((p) => ({ ...p, preview: p.source && "preview" in p.source ? p.source.preview : defaultThumbUrl, sourceKind: "installed", installed: true }));
    for (const pagePets of Object.values(catalogPages)) for (const p of pagePets) byId.set(p.id, { ...p, sourceKind: "catalog", installed: false });
    const q = query.trim().toLowerCase();
    if (q && catalogSearch) {
      for (const p of catalogSearch) {
        if (`${p.displayName} ${p.searchText ?? ""} ${p.id}`.toLowerCase().includes(q)) byId.set(p.id, { ...byId.get(p.id), ...p, sourceKind: "catalog", installed: false });
      }
    }
    for (const p of byId.values()) if (!installed.has(p.id)) rows.push(p);
    for (const p of codex.pets ?? []) if (!installed.has(p.id)) rows.push({ ...p, sourceKind: "codex", installed: false });
    return rows.filter((p) => {
      if (filter === "installed" && !p.installed) return false;
      if (filter === "codex" && p.sourceKind !== "codex" && !(installed.get(p.id)?.source?.kind === "codex")) return false;
      if (filter === "original" && !p.original && !p.builtIn) return false;
      if ((filter === "western" || filter === "asian") && p.category !== filter) return false;
      return !q || `${p.displayName} ${p.description ?? ""} ${p.searchText ?? ""} ${p.id}`.toLowerCase().includes(q);
    });
  }, [state, catalogPages, catalogSearch, codex, filter, query]);
  const selected = pets.find((p) => p.id === selectedId) ?? pets[0];
  const defaultId = state?.preferences.defaultPetId;

  async function act(label: string, fn: () => Promise<unknown>) {
    if (!selected) return;
    try { setBusy(label); setError(""); await fn(); await load(); }
    catch (err) { setError(String((err as Error)?.message ?? err)); }
    finally { setBusy(""); }
  }

  useEffect(() => {
    if (!query.trim() || catalogSearch) return;
    void api.getCatalogSearch().then((result) => {
      if (result.error) setError(result.error);
      setCatalogSearch(result.pets ?? []);
    }).catch((err) => setError(String(err?.message ?? err)));
  }, [query, catalogSearch]);

  async function loadCatalogPage(page: number) {
    if (catalogPages[page]) { setCatalogPage(page); return; }
    try {
      setBusy("Loading page"); setError("");
      const next = await api.getCatalogPage(page);
      setCatalog(next); setCatalogPage(next.page ?? page); setCatalogPages((pages) => ({ ...pages, [next.page ?? page]: next.pets }));
    } catch (err) { setError(String((err as Error)?.message ?? err)); }
    finally { setBusy(""); }
  }

  return <main className="app-shell">
    <header className="hero">
      <img src={logoUrl} alt="OpenPets" />
      <div><p className="eyebrow">Control Center Preview</p><h1>Pets</h1><p>Install, import, preview, and choose your default desktop companion.</p></div>
    </header>
    {error && <div className="error">{error}</div>}
    <div className="layout">
      <GlassCard className="gallery">
        <div className="toolbar"><SearchInput value={query} onChange={(e) => setQuery(e.target.value)} /><StatusPill tone="slate">{pets.length} pets</StatusPill></div>
        <div className="filters">{(["all", "installed", "original", "western", "asian", "codex"] as Filter[]).map((f) => <button key={f} className={`filter ${filter === f ? "active" : ""} ${f === "original" ? "original" : ""}`} onClick={() => setFilter(f)}>{f}</button>)}</div>
        {!!catalog?.pageCount && catalog.pageCount > 1 && <div className="pager"><Button variant="secondary" disabled={!!busy || catalogPage <= 0} onClick={() => void loadCatalogPage(catalogPage - 1)}>Prev</Button><span>Catalog page {catalogPage + 1} of {catalog.pageCount}</span><Button variant="secondary" disabled={!!busy || catalogPage >= catalog.pageCount - 1} onClick={() => void loadCatalogPage(catalogPage + 1)}>Next</Button></div>}
        <div className="pets-grid">{pets.map((pet) => <button key={`${pet.sourceKind}-${pet.id}`} className={`pet-card ${selected?.id === pet.id ? "selected" : ""}`} onClick={() => setSelectedId(pet.id)}>
          <span className="thumb"><img src={pet.preview || defaultThumbUrl} alt="" /></span><span><b>{pet.displayName}</b><small>{pet.description || pet.id}</small></span>
          <span className="badges">{pet.id === defaultId && <StatusPill tone="green">Default</StatusPill>}{pet.installed && <StatusPill>Installed</StatusPill>}{pet.sourceKind === "codex" && <StatusPill tone="orange">Codex</StatusPill>}</span>
        </button>)}</div>
      </GlassCard>
      <GlassCard className="detail">
        {selected ? <><p className="eyebrow">Pet detail</p><h2>{selected.displayName}</h2><p className="desc">{selected.description || selected.id}</p>
          <div className="stage">{selected.spritesheet ? <div className="sprite-preview" style={{ backgroundImage: `url(${selected.spritesheet})` }} role="img" aria-label={`${selected.displayName} animated preview`} /> : <img src={selected.preview || defaultThumbUrl} alt="" />}</div>
          <div className="meta"><StatusPill tone={selected.broken ? "red" : selected.installed ? "green" : "blue"}>{selected.broken ? "Broken" : selected.installed ? "Ready" : "Available"}</StatusPill>{selected.builtIn && <StatusPill tone="orange">Originals</StatusPill>}</div>
          <div className="actions">
            {!selected.installed && selected.sourceKind === "catalog" && <Button disabled={!!busy} onClick={() => act("Installing", () => api.installPet(selected.id))}>{busy || "Install pet"}</Button>}
            {!selected.installed && selected.sourceKind === "codex" && <Button disabled={!!busy} onClick={() => act("Importing", () => api.importCodexPet(selected.id))}>{busy || "Import Codex pet"}</Button>}
            {selected.installed && selected.id !== defaultId && !selected.broken && <Button disabled={!!busy} onClick={() => act("Setting default", () => api.setDefaultPet(selected.id))}>Set default</Button>}
            {selected.installed && !selected.builtIn && !selected.protected && <Button variant="danger" disabled={!!busy} onClick={() => act("Removing", () => api.removePet(selected.id))}>Remove</Button>}
            <Button variant="secondary" disabled={!!busy} onClick={() => void load()}>Refresh</Button>
          </div></> : <p>No pets available.</p>}
      </GlassCard>
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
