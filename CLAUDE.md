# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ceru Music (澜音) is a cross-platform desktop music player built on **Tauri 2 (Rust)** + **Vue 3 / Vite**. The app ships only a player + plugin runtime framework; music data comes from user-installed plugins and built-in source adapters, not from this repo.

**Critical context:** this project was migrated from Electron to Tauri. The renderer still calls a `window.api` surface that originally came from an Electron preload script. That surface is now reimplemented on top of Tauri in `src/renderer/src/tauri-bridge.ts`. When you see `window.api.*` in renderer code, it resolves there — **not** to a real Electron API. Do **not** add Electron IPC or Node-only renderer dependencies; route all native behavior through `window.api` (extend the bridge) or new Tauri commands.

## Commands

Package manager is **pnpm** (Node 22+). Rust toolchain required for native builds.

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install JS deps |
| `pnpm dev` / `pnpm tauri:dev` | Run the full Tauri desktop app (spawns `pnpm web:dev` for the renderer) |
| `pnpm web:dev` | Vite renderer only at `localhost:5173`. Fast for pure UI work, but Tauri `invoke`/native calls fail outside the app shell |
| `pnpm web:build` | `typecheck` + Vite renderer build (output to `dist/`) |
| `pnpm build` / `pnpm tauri:build` | Build the packaged desktop app |
| `pnpm typecheck` | `vue-tsc --noEmit -p tsconfig.web.json` |
| `pnpm lint` | `eslint --fix` then `typecheck` |
| `pnpm format` | Prettier across the repo |
| `pnpm test` | Jest |
| `pnpm docs:dev` / `pnpm docs:build` | VitePress docs site in `docs/` |

For the Rust backend, run `cargo check` / `cargo clippy` / `cargo fmt` from `src-tauri/`.

**Testing note:** `pnpm test` runs Jest, but there is currently **no `jest.config` and no project test files** (the `*.test.ts` files referenced in some `AGENTS.md` notes no longer exist). Add a Jest config when introducing the first real test. Use `pnpm typecheck` + `pnpm web:build` as the practical verification gate today.

## Architecture

### Process split
- **Renderer** (`src/renderer/src`): Vue 3 SFCs, Composition API, Pinia. Two app windows are defined in `src-tauri/tauri.conf.json`: `main` and a frameless transparent `lyric-window` (route `/#/desktop-lyric`). Both windows are `decorations: false`, so the title bar is custom (`components/TitleBarControls.vue`).
- **Rust backend** (`src-tauri/src`): every native capability is a `#[tauri::command]`. All commands are registered in `main.rs` via `generate_handler![...]`. Modules: `config` (app config + window bounds), `db` (SQLite: local-music index + user playlists), `local_music` + `scan` (filesystem library), `download`, `http_proxy` (the `tauri_request` command — a Rust HTTP client used to bypass browser CORS for plugins/cover art), `plugins` (plugin storage on disk).

### The bridge: `src/renderer/src/tauri-bridge.ts` (~1700 lines)
Single most important file. It is imported first in `main.ts` and assigns `window.api`. It:
- Reimplements the legacy Electron `window.api` surface (window controls, downloads, autoUpdater, config, local music, plugins, etc.) over Tauri `invoke()` and `listen()`.
- Hosts the **plugin sandbox** (`loadPluginSandbox`): plugin code runs via `new Function(...)` with an injected `cerumusic` API object and a per-plugin `console` that streams to `plugin.log`. There is **no `require`/Node access** inside plugins; plugin network requests go through `cerumusic.request` → Rust `tauri_request`. Includes a `BrowserBuffer` (Uint8Array) polyfill so Node-style plugin code runs in the browser.

### Plugin system
- Two plugin formats: `cr` (Ceru-native) and `lx` (LX Music-compatible; `buildLxExports` adapts LX event handlers). The UI for managing them is `components/Settings/plugins.vue`.
- **Storage is Rust-side** (`src-tauri/src/plugins.rs`): each plugin lives at `<app_config_dir>/plugins/<sanitized-id>/` as `plugin.js`, `metadata.json`, `config.json`, `plugin.log`. Relevant commands: `plugin_save`, `plugin_save_metadata`, `plugin_delete`, `plugin_get_config`, `plugin_save_config`, `plugin_get_log`, `plugin_append_log`.

### Built-in music SDK
`src/renderer/src/services/musicSdk/` contains source adapters (`wy`, `tx`, `kg`, `kw`, `mg`, `bd`, `git`) derived from the LX-music SDK, aggregated in `musicSdk/index.js` and consumed by the bridge. Treat these `.js` files as vendored adapter code — match their existing style rather than rewriting.

### State & audio
- Pinia stores in `src/renderer/src/store/`, persisted with `pinia-plugin-persistedstate@4.x`. Configure persistence with `persist: { key, pick }` (or `omit`) — the legacy `paths` option is **silently ignored** in 4.x. Don't persist volatile playback state (lyrics/queue); only user settings.
- Audio playback is a singleton `HTMLAudioElement` wrapper (`utils/audio/audioManager.ts`) wired to the `ControlAudio` store's pub/sub bus. SMTC / OS media keys via `utils/audio/useSmtc.ts`.

### Cloud backend
A hosted API (`api.ceru.shiqianjiang.cn`, base in `src/common/api/config.json`) powers auth, song/playlist **sharing** (`src/renderer/src/api/share.ts`), and cloud sync. `utils/request.ts` is the Axios wrapper that injects the auth token. Real-time "listen together" uses `socket.io-client` (`store/ListenTogether.ts`).

## Conventions

- **Auto-imports are on.** Vue/Pinia APIs and naive-ui helpers (`useMessage`, `useDialog`, …) and tdesign (`DialogPlugin`, `NotifyPlugin`) are auto-imported via `unplugin-auto-import` / `unplugin-vue-components`. Don't add manual imports for them; see `src/renderer/auto-imports.d.ts` and `components.d.ts` (generated — don't hand-edit).
- **Dual UI kit:** `N*` components are naive-ui, `T*`/`t-*` are tdesign-vue-next. Avoid mixing both within a single view.
- **Path aliases** (vite.config + tsconfig.web.json): `@renderer`, `@common`, `@types`, `@components`, `@services`, `@store`, `@assets`.
- **Nested `AGENTS.md`** files exist (repo root, `docs/`, `src/renderer/`, `src/renderer/src/store/`, `src/renderer/src/utils/`, `website/`). Follow the closest one when editing a subtree — but verify specifics against the code, as some notes (file paths, test files) have drifted from the current tree.
- Commits follow **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `chore:`). License is **AGPL-3.0-only**.

## Gotchas

- The directory tree in `README.md` and some `AGENTS.md` paths are partially **stale** (e.g. `services/music/service-base.ts` no longer exists; the service layer is `tauri-bridge.ts` + `services/musicSdk/`). Trust the code over those trees.
- `pnpm web:dev` renders the UI in a plain browser; anything going through `window.api`/Tauri `invoke` will throw there. Use `pnpm dev` to exercise native paths.
- TypeScript is configured loosely (`strict: false`, `noImplicitAny: false`) and `tauri-bridge.ts` is `@ts-nocheck`. `moduleResolution` is `bundler` so subpath imports (e.g. `nsfwjs/core`) resolve like Vite — used to avoid bundling the full 33MB nsfwjs model.
