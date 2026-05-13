# packages/pi/src/

Source for the OpenPets Pi integration package.

## Entry points

- `extension.ts`: Default Pi extension export. Calls `createOpenPetsPiExtension()`.
- `index.ts`: Public package exports for the extension and testable runtime helpers.

## Runtime modules

- `runtime.ts`: Pi extension registration, event classification, non-blocking OpenPets dispatch, `/openpets` command parsing, speech validation, and debug sanitization.

## Contract checks

- `check-pi.ts`: Unit-style contract checks for event classification, command parsing, privacy rejection corpus, non-blocking scheduling, and extension registration.
- `check-pi-compat.ts`: Pi-style compatibility smoke checks for event handlers whose payloads do not include a `type` field.

## Important constraints

- Do not add `pi.registerTool()` in Phase 21 MVP.
- Do not inspect content-heavy Pi events such as prompt/message/tool result streams for speech.
- Keep automatic handlers fire-and-forget with swallowed IPC failures.
