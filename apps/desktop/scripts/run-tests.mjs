#!/usr/bin/env node
/**
 * Desktop test runner
 * Runs preload checks, builds and runs behavior tests, contract tests, then remaining dist checks.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const preloadChecks = ["control-center-preload.cjs", "pet-preload.cjs", "plugin-sdk-preload.cjs"];
const behaviorTests = [
  ".test-dist/tests/lease-manager.test.js",
  ".test-dist/tests/onboarding-state.test.js",
  ".test-dist/tests/update-version.test.js",
  ".test-dist/tests/reaction-animation-mapping.test.js",
  ".test-dist/tests/zip-safety.test.js",
  ".test-dist/tests/codex-pets.test.js",
  ".test-dist/tests/claude-memory.test.js",
  ".test-dist/tests/plugin-config.test.js",
  ".test-dist/tests/plugin-state.test.js",
  ".test-dist/tests/plugin-runtime.test.js",
  ".test-dist/tests/plugin-catalog-validation.test.js",
  ".test-dist/tests/plugin-package.test.js",
  ".test-dist/tests/plugin-service.test.js",
  ".test-dist/tests/plugin-ui-static.test.js",
];
const contractTests = [
  ".test-dist/contracts/local-ipc-protocol.contract.js",
  ".test-dist/contracts/catalog-fixture.contract.js",
  ".test-dist/contracts/plugin-manifest.contract.js",
];
const distChecks = [
  "dist/check-opencode-desktop-setup.js",
  "dist/check-cursor-desktop.js",
  "dist/check-packaging-contract.js",
];

function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: rootDir,
      env: { ...process.env, OPENPETS_DESKTOP_ROOT: rootDir },
      ...options,
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
      } else {
        resolve();
      }
    });
    child.on("error", reject);
  });
}

async function main() {
  // 1. Preload syntax checks
  console.log("\n[1/5] Checking preload syntax...");
  for (const preload of preloadChecks) await run("node", ["--check", preload]);

  // 2. Build tests
  console.log("\n[2/5] Building tests...");
  await run("pnpm", ["test:build"]);

  // 3. Run behavior tests
  console.log("\n[3/5] Running behavior tests...");
  for (const test of behaviorTests) await run("node", [test]);

  // 4. Run contract tests
  console.log("\n[4/5] Running contract tests...");
  for (const test of contractTests) await run("node", [test]);

  // 5. Run remaining dist checks
  console.log("\n[5/5] Running dist checks...");
  for (const check of distChecks) {
    await run("node", [check]);
  }

  console.log("\n✓ All tests passed!");
}

main().catch((err) => {
  console.error("\n✗ Test suite failed:", err.message);
  process.exit(1);
});
