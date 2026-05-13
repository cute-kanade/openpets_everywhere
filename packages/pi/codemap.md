# packages/pi/

Publishable npm package for the OpenPets Pi coding-agent integration.

## Responsibility

- Exposes `@open-pets/pi` as a Pi package with a Pi extension resource.
- Maps Pi session/tool activity to safe OpenPets reactions through `@open-pets/client`.
- Registers a user slash command namespace, `/openpets`, for status, test, react, and say commands.
- Keeps MVP behavior default-pet-only and non-blocking; no Pi model-callable tools are registered.

## Structure

- `package.json`: npm metadata, Pi package resource declaration, exports, checks, and publish files.
- `tsconfig.json`: TypeScript build config.
- `src/`: Extension runtime and contract checks.

## Flow

```text
Pi extension loader
  -> packages/pi/src/extension.ts
  -> packages/pi/src/runtime.ts
  -> @open-pets/client
  -> OpenPets desktop local IPC
```

## Safety notes

- Automatic events use reactions and fixed message pools only.
- Prompt text, assistant text, tool output, command output, file paths, URLs, and secrets are not forwarded.
- OpenPets IPC failures are swallowed by automatic event handlers so Pi execution continues.
