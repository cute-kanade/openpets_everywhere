export type PluginsWindowDefinition = {
  readonly title: string;
  readonly heading: string;
  readonly description: string;
};

export function createPluginsHtml(definition: PluginsWindowDefinition): string {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(definition.title)}</title>
        <style>
          :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          body { margin: 0; min-height: 100vh; background: #020617; color: #e5e7eb; }
          main { width: min(1040px, calc(100vw - 48px)); margin: 0 auto; padding: 32px 0 48px; }
          header { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 24px; }
          h1 { margin: 0 0 8px; font-size: 32px; }
          p { color: #cbd5e1; line-height: 1.6; }
          button, input, select, textarea { font: inherit; }
          button { border: 1px solid rgba(148, 163, 184, 0.35); border-radius: 12px; background: rgba(15, 23, 42, 0.95); color: #e5e7eb; padding: 9px 12px; cursor: pointer; }
          button.primary { background: linear-gradient(135deg, #2563eb, #7c3aed); border-color: transparent; }
          button:disabled { cursor: not-allowed; opacity: 0.55; }
          .tabs { display: flex; gap: 8px; margin-bottom: 18px; }
          .tab { color: #bfdbfe; }
          .tab.active { background: rgba(37, 99, 235, 0.24); border-color: rgba(96, 165, 250, 0.65); }
          .layout { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; gap: 18px; align-items: start; }
          .panel, .plugin-card { border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 20px; background: rgba(15, 23, 42, 0.78); box-shadow: 0 18px 60px rgba(0,0,0,0.24); }
          .panel { padding: 18px; }
          .plugin-list { display: grid; gap: 10px; }
          .plugin-card { width: 100%; text-align: left; padding: 14px; }
          .plugin-card.active { border-color: rgba(96, 165, 250, 0.75); }
          .muted { color: #94a3b8; }
          .pill { display: inline-flex; border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 999px; padding: 3px 8px; color: #bfdbfe; font-size: 12px; margin: 4px 4px 0 0; }
          .error { color: #fecaca; }
          .success { color: #bbf7d0; }
          .field { display: grid; gap: 6px; margin: 14px 0; }
          label { color: #dbeafe; font-weight: 700; }
          input, select, textarea { border: 1px solid rgba(148, 163, 184, 0.28); border-radius: 12px; background: rgba(2, 6, 23, 0.7); color: #e5e7eb; padding: 10px 12px; }
          textarea { min-height: 96px; resize: vertical; }
          .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
          .empty { padding: 28px; text-align: center; }
        </style>
      </head>
      <body data-openpets-view="plugins">
        <main>
          <header>
            <div>
              <h1>${escapeHtml(definition.heading)}</h1>
              <p>${escapeHtml(definition.description)}</p>
            </div>
            <button id="plugins-refresh" type="button">Refresh</button>
          </header>
          <nav class="tabs" aria-label="Plugin sections">
            <button id="plugins-installed-tab" class="tab active" type="button">Installed</button>
            <button id="plugins-discover-tab" class="tab" type="button">Discover</button>
            <button id="plugins-developer-tab" class="tab" type="button">Developer</button>
          </nav>
          <section id="plugins-status" class="muted" aria-live="polite">Loading plugins…</section>
          <section id="plugins-installed-view" class="layout">
            <div class="panel"><div id="plugins-list" class="plugin-list"></div></div>
            <div id="plugins-detail" class="panel empty">Select a plugin to configure it.</div>
          </section>
          <section id="plugins-discover-view" class="panel" hidden>
            <div id="plugins-discover-list" class="plugin-list"></div>
          </section>
          <section id="plugins-developer-view" class="panel" hidden>
            <h2>Developer plugins</h2>
            <p class="muted">Load a local manifest-only plugin folder for development. OpenPets snapshots only openpets.plugin.json into app data.</p>
            <button id="plugins-load-local" class="primary" type="button">Load local plugin folder</button>
          </section>
        </main>
      </body>
    </html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
