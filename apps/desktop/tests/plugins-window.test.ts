import assert from "node:assert/strict";

import { createPluginsHtml } from "../src/plugins-window.js";

const html = createPluginsHtml({ title: "Plugins", heading: "Plugins", description: "Manage plugins." });

assert.match(html, /data-openpets-view="plugins"/);
assert.match(html, /Content-Security-Policy/);
assert.doesNotMatch(html, /script-src/);
assert.doesNotMatch(html, /https:\/\//);
assert.match(html, /id="plugins-list"/);
assert.match(html, /id="plugins-detail"/);
assert.match(html, /id="plugins-discover-tab"/);
assert.match(html, /id="plugins-discover-view"/);

console.error("Plugins window validation passed.");
