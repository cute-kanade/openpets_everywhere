# packages/sdk/src

Public type surface for OpenPets plugin authors. Types only — no runtime.

- `index.ts` — the published contract: the `OpenPetsContext` (`ctx`) interface,
  command/status/http/schedule types, the `OpenPetsPluginDefinition` shape, and
  the ambient `OpenPetsPlugin` global. Mirrors the runtime implemented by
  `apps/desktop/src/plugin-sdk-bridge.ts`. Keep the two in sync when the SDK
  surface changes.
- `check-plugin-sdk.ts` — contract test. Compiles a representative plugin
  against the exported types and runs it against `createMockContext`, which is
  also the recommended pattern for unit-testing a plugin's `start` handler.
