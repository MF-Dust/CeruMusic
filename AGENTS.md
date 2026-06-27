# PROJECT KNOWLEDGE BASE

## OVERVIEW

Ceru Music (澜音) is a Tauri + Vue 3 + TypeScript desktop music player. Native desktop and local-file capabilities live in Rust under `src-tauri/`; the renderer is a Vite/Vue app under `src/renderer/`. The app relies on user-supplied plugins for lawful music metadata and does not ship music sources.

## STRUCTURE

```
./
├── src/
│   ├── renderer/       # Vue 3 renderer, Pinia stores, views, components
│   ├── common/         # Shared TS types + lyric utilities
│   └── types/          # Extra shared declarations
├── src-tauri/          # Tauri v2 Rust backend and app packaging config
├── docs/               # VitePress documentation site
├── website/            # Static marketing microsite
├── scripts/            # Helper scripts
├── assets/             # Screenshots + readme media
└── .github/workflows/  # Release asset sync
```

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Tauri commands/native services | `src-tauri/src/` | Config, SQLite, local music scan/tag/cover, download, plugin files, HTTP proxy |
| Renderer UI + state | `src/renderer/src/` | Vue 3 + Pinia. Entry at `main.ts`; Tauri bridge at `tauri-bridge.ts` |
| Shared types/utilities | `src/common/`, `src/types/` | Basic declarations reused by renderer |
| Music SDK adapters | `src/renderer/src/services/musicSdk/` | Browser/Tauri request-backed provider adapters |
| Docs site | `docs/` | VitePress |

## CONVENTIONS

- Formatting: Prettier (single quotes, no semicolons, 2-space indent, 100 char width).
- Package manager: pnpm. Tauri dev/build scripts are `pnpm dev` and `pnpm build`; frontend-only build is `pnpm web:build`.
- Path aliases: `@common`, `@renderer`, `@types`, `@assets`, `@store`, `@services`.
- Public renderer bridge: keep `window.api` stable; add Tauri commands behind it instead of introducing direct backend calls throughout views.
- Local music IDs use `md5(normPath(filePath))`; keep this stable to avoid duplicate local tracks.

## COMMANDS

```bash
pnpm dev       # Tauri dev with Vite renderer
pnpm web:build # Typecheck + Vite renderer build
pnpm build     # Tauri production build
pnpm typecheck
pnpm test
```

## NOTES

- Electron main/preload/builder resources were removed; do not reintroduce Electron-only IPC or Node native dependencies for renderer features.
- Tauri-first modules should expose commands/events in Rust and adapt them through `src/renderer/src/tauri-bridge.ts`.
- Batch audio recognition, DLNA, desktop lyric IPC forwarding, and auto-update are currently degraded or pending Tauri-native follow-up work.
