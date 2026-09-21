# Local Setup Guide

How to get Open Generative AI running on your own machine, and what to do when a
step fails. For the architecture and feature overview see the [README](../README.md).

## Pick your path

| Goal | Path |
|---|---|
| Just use the app | [Download a prebuilt installer](../README.md#-download-desktop-app) — no Node.js, no terminal |
| Self-host the web version | [Source setup](#source-setup) → `npm run dev` |
| Build the desktop app | [Source setup](#source-setup) → `npm run electron:dev` |

Everything below the next heading is for building from source.

## Prerequisites

- **Node.js 18+** (`node -v`) and **npm**
- **git**
- A network that can reach `registry.npmjs.org`, `github.com`, and — for the
  desktop app — GitHub release assets (where Electron's prebuilt binary lives)
- A **Muapi access key** for cloud models: <https://muapi.ai/access-keys>
  (optional — local models need no key, but they are desktop-app only)

## Source setup

```bash
git clone --recurse-submodules https://github.com/Anil-matcha/Open-Generative-AI.git
cd Open-Generative-AI
npm run setup:local
```

`npm run setup:local` runs four steps and degrades gracefully at each one:

1. **Initializes the submodules** (`packages/Vibe-Workflow`, `packages/Open-Poe-AI`,
   `packages/Open-AI-Design-Agent`). If the commits pinned in this repo no longer
   exist upstream, it checks out each submodule's default branch instead of aborting.
2. **Installs dependencies.** If `npm install` fails because Electron's prebuilt
   binary cannot be downloaded, it retries with the binary skipped — the web app
   does not need it.
3. **Builds the workspace packages** (`studio`, `workflow-builder`, `agents`,
   `design-agent`). This step is required: `npm install` alone leaves them unbuilt
   and both dev servers fail to start.
4. **Reports network reachability** for the hosts the app depends on
   (skip with `npm run setup:local -- --skip-check`).

`npm run setup` is the strict, no-fallback equivalent — use it if you prefer a hard
failure over a degraded setup.

## Running

```bash
npm run dev            # web version (Next.js)      -> http://localhost:3000
npm run electron:dev   # desktop app (Electron+Vite) -> native window
```

`http://localhost:3000` redirects to `/studio`, which hosts every studio
(Image, Video, Audio, Clipping, Vibe Motion, Lip Sync, Cinema, Marketing,
Workflows, Agents, Design Agent, Apps, MCP & CLI).

Production build:

```bash
npm run build && npm start          # web
npm run electron:build:linux        # installers -> release/ (mac/win variants too)
```

## First run: the API key

The app opens an API-key modal on first use. Paste the **key value** from
<https://muapi.ai/access-keys> — not the key name or label. It is stored in
`localStorage` and sent as the `x-api-key` header through this app's own
`/api/*` routes, so the browser never calls `api.muapi.ai` directly.

Skip the key entirely if you only intend to use local models (desktop app,
**Settings → Local Models**).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OGA_ALLOWED_DEV_ORIGINS` | `*.e2b.app` | Comma-separated extra origins allowed to fetch `/_next/*` from the dev server when it is reached through a proxy or tunnel hostname (Codespaces, containers, sandbox previews). |
| `OGA_FRAME_ANCESTORS` | `'none'` in production, `*` in development | CSP `frame-ancestors` value, i.e. who may embed the app in an iframe. Production keeps clickjacking protection; development allows preview panes. Set to `'self'` to lock it down in dev too. |
| `OPEN_GENERATIVE_AI_LOCAL_AI_DIR` | Electron app-data dir | Where the desktop app stores sd.cpp engine + model weights (`bin/`, `models/`, `tmp/`). Point it at another drive to keep multi-GB weights off your system disk. |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `fatal: remote error: upload-pack: not our ref …` then `Fetched in submodule path …, but it did not contain …` | The submodule commit pinned by this repo no longer exists upstream (force-push / history rewrite) | `npm run setup:local` — it falls back to the submodule's default branch. Manually: `git -C packages/Vibe-Workflow fetch origin && git -C packages/Vibe-Workflow checkout origin/main` |
| `npm error path …/node_modules/electron` with `unable to verify the first certificate`, `ECONNRESET`, or a 403 during install | Electron's prebuilt binary host is blocked (proxy, firewall, sandbox) | `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install`. The web version works; `npm run electron:dev` does not until you run `npm rebuild electron` on an unrestricted network |
| `Couldn't find a 'pages' directory` | Next.js cannot see `app/`, usually because workspace packages are missing or unbuilt | Run `npm run setup:local` from the repo root (the directory containing `app/`, `package.json`, `next.config.mjs`) |
| `Failed to download 'Inter' from Google Fonts. Using fallback font instead.` | No access to `fonts.googleapis.com` | Harmless — the app renders with a system font. Ignore, or self-host the font if the visual difference matters |
| Setup reports `api.muapi.ai NOT reachable (ECONNRESET)` and generation fails in the UI | The **server** running the app cannot reach the Muapi API | Unblock `api.muapi.ai` for the machine running the dev server. A browser-side proxy will not help: all API calls are proxied server-side by design, so the restriction must be lifted where the app runs |
| `⚠ Cross origin request detected from <host> to /_next/* resource` | Dev server reached through a proxy/tunnel host | Add the host to `OGA_ALLOWED_DEV_ORIGINS` and restart the dev server |
| Preview pane shows a blank frame / "refused to connect" | `X-Frame-Options` or CSP `frame-ancestors` blocks embedding | Development allows framing by default; if you set `OGA_FRAME_ANCESTORS` explicitly, use `*` or the embedding host |

## Verifying the install

```bash
node --test                     # 17 tests across tests/*.test.js
npm run dev                     # then: curl -I http://localhost:3000/studio
```

A healthy web install serves `200 OK` for `/studio` with the title
`Studio — Open Generative AI`, and no `x-frame-options: DENY` header in
development. The first request compiles the route and can take ~20 s; later
requests are fast.
