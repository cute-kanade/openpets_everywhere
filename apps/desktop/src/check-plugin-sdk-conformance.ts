/**
 * Drift guard between the runtime plugin SDK and the published
 * `@open-pets/plugin-sdk` type contract.
 *
 * These are compile-time assertions: if the runtime's plugin-facing surface
 * (namespaces) or the JavaScript permission set ever diverges from what the
 * published package promises authors, `tsc` fails here. Keep the package and
 * the bridge in lockstep.
 */
import type { OpenPetsContext, OpenPetsPermission } from "@open-pets/plugin-sdk";

import type { PluginJavascriptPermission } from "./plugin-manifest.js";
import type { PluginSdkApi } from "./plugin-sdk-bridge.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// Every namespace the published SDK exposes (ctx.pet, ctx.schedule, …) must
// exist on the runtime API, and the runtime must expose nothing extra.
type _NamespacesMatch = Expect<Equal<keyof PluginSdkApi, keyof OpenPetsContext>>;

// The JavaScript plugin permission union must match the published contract.
type _PermissionsMatch = Expect<Equal<PluginJavascriptPermission, OpenPetsPermission>>;

// Reference the aliases so unused-type tooling never strips the guard.
export type PluginSdkConformance = [_NamespacesMatch, _PermissionsMatch];

console.error("Plugin SDK conformance validation passed.");
