# Repository Guidelines

## Project Structure & Module Organization

Ceru Music is a Tauri 2 desktop app with a Vue 3/Vite renderer. Main frontend code lives in `src/renderer/src`: `components/` for UI, `views/` for pages, `store/` for Pinia state, `services/` for app services, and `utils/` for audio, playlist, color, and helpers. Shared TypeScript is under `src/common` and `src/types`. Native commands and local system integration live in `src-tauri/src`; Tauri config is in `src-tauri/tauri.conf.json`. Documentation is a VitePress site in `docs/`, while `plugins/` contains service plugin examples.

Nested `AGENTS.md` files provide more specific guidance for some subtrees; follow the closest one when editing there.

## Build, Test, and Development Commands

- `pnpm install`: install Node dependencies from `pnpm-lock.yaml`.
- `pnpm dev` or `pnpm tauri:dev`: run the full Tauri desktop app.
- `pnpm web:dev`: run only the Vite renderer for UI work.
- `pnpm web:build`: typecheck the renderer and create a web build.
- `pnpm build`: build the packaged Tauri app.
- `pnpm lint`: run ESLint with fixes, then `vue-tsc`.
- `pnpm format`: format the repository with Prettier.
- `pnpm test`: run Jest tests.
- `pnpm docs:dev` / `pnpm docs:build`: serve or build the docs site.

## Coding Style & Naming Conventions

Use TypeScript and Vue single-file components for renderer changes. Prefer Composition API and existing auto-import patterns in `src/renderer/auto-imports.d.ts` and `components.d.ts`. Keep components in PascalCase, stores named around `use*Store`, and helper modules in lower camel case or filenames matching nearby code. Use Prettier for formatting; ESLint is permissive but should still be run before handoff.

## Testing Guidelines

Jest is the configured test runner. Place focused tests near the behavior being changed when practical, or use root-level `test-*.js` only for temporary diagnostics. Run `pnpm test` for unit coverage and `pnpm web:build` for TypeScript and renderer integration checks. For Rust backend changes, also run relevant Cargo checks from `src-tauri` when available.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit prefixes such as `feat:`, `chore:`, and `refactor:`. Keep commits scoped and imperative, for example `feat: add playlist import validation`. Pull requests should include a short summary, test results, linked issues when applicable, and screenshots or recordings for visible UI changes.

## Security & Configuration Tips

Do not commit real credentials or music source secrets. Keep local settings in `.env` or ignored files, and route desktop-native behavior through Tauri commands/plugins rather than adding Node or Electron-only dependencies to the renderer.
