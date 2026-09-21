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
**Settings → Local Models**). To have the server supply the key instead of each
visitor, see [Self-hosting with one API key](#self-hosting-with-one-api-key).

## Self-hosting with one API key

By default every visitor pastes their own Muapi key, and it is kept in their
browser. A self-hosted instance can instead hold **one key for everybody**:

```bash
MUAPI_API_KEY=your-muapi-key npm run dev      # dev
MUAPI_API_KEY=your-muapi-key npm start        # production, after npm run build
```

With that set:

- no visitor is prompted, and no key is ever sent to a browser;
- the key is attached to outbound requests by this app's own `/api/*` routes, so
  it never appears in page source, `localStorage`, or network calls the browser
  makes;
- a visitor who *does* paste their own key overrides the deployment's key for
  their own session — useful for testing a different account;
- unset it and behaviour is exactly as before (the key prompt comes back).

It is read at request time, so `next start` picks it up from its own
environment — you do not need to rebuild after changing it. In the app,
**Settings** shows `Provided by this deployment` while a server key is in use.

## Working on the UI without API access

If the machine running the app cannot reach `api.muapi.ai` (locked-down CI, a
sandbox, a corporate network), every studio shows a proxy error and no UI work is
possible. Run a local stand-in instead:

```bash
npm run mock:muapi                                 # terminal 1, listens on 127.0.0.1:9099
MUAPI_BASE_URL=http://127.0.0.1:9099 npm run dev   # terminal 2
```

The mock implements enough of the Muapi contract for the full flow — submit,
poll, balance, upload, and the list endpoints the studios load — and returns a
**self-describing SVG placeholder** for every result, so a mock output is never
mistaken for a real generation. Because results are `data:` URLs, they render in
the app without any network access.

Caveats:

- Results are placeholders, not model output. Any API key is accepted.
- Video studios play their result in a `<video>` element, which an SVG cannot
  fill. Set `MOCK_VIDEO_URL` to a public sample MP4 the **browser** can reach and
  video endpoints will return that instead.
- Point `MUAPI_BASE_URL` back at `https://api.muapi.ai` (or unset it) for real
  generation.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MUAPI_API_KEY` | unset | Server-side Muapi key. When set, every `/api/*` proxy route uses it for visitors who have not supplied their own key, and the key prompt is skipped. See [Self-hosting with one API key](#self-hosting-with-one-api-key). |
| `MUAPI_BASE_URL` | `https://api.muapi.ai` | Upstream base URL for Muapi calls. Point it at a Muapi-compatible gateway, regional mirror, or staging endpoint. Set before starting the server. |
| `OGA_ALLOWED_DEV_ORIGINS` | `*.e2b.app` | Comma-separated extra origins allowed to fetch `/_next/*` from the dev server when it is reached through a proxy or tunnel hostname (Codespaces, containers, sandbox previews). |
| `OGA_FRAME_ANCESTORS` | `'none'` in production, `*` in development | CSP `frame-ancestors` value, i.e. who may embed the app in an iframe. Production keeps clickjacking protection; development allows preview panes. Set to `'self'` to lock it down in dev too. |
| `OPEN_GENERATIVE_AI_LOCAL_AI_DIR` | Electron app-data dir | Where the desktop app stores sd.cpp engine + model weights (`bin/`, `models/`, `tmp/`). Point it at another drive to keep multi-GB weights off your system disk. |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `fatal: remote error: upload-pack: not our ref …` then `Fetched in submodule path …, but it did not contain …` | The submodule commit pinned by this repo no longer exists upstream (force-push / history rewrite) | `npm run setup:local` — it falls back to the submodule's default branch. Manually: `git -C packages/Vibe-Workflow fetch origin && git -C packages/Vibe-Workflow checkout origin/main` |
| `npm error path …/node_modules/electron` with `unable to verify the first certificate`, `ECONNRESET`, or a 403 during install | Electron's prebuilt binary host is blocked (proxy, firewall, sandbox) | `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install`. The web version works; `npm run electron:dev` does not until you run `npm rebuild electron` on an unrestricted network |
| `Couldn't find a 'pages' directory` | Next.js cannot see `app/`, usually because workspace packages are missing or unbuilt | Run `npm run setup:local` from the repo root (the directory containing `app/`, `package.json`, `next.config.mjs`) |
| `Failed to download 'Inter' from Google Fonts. Using fallback font instead.` (dev) | No access to `fonts.googleapis.com` | Harmless — the dev server falls back to a system font. The **production build has no such fallback**: `npm run build` fails outright with `` `next/font` error: Failed to fetch `Inter` ``. Build on a machine that can reach Google Fonts, or replace `next/font/google` in `app/layout.js` with `next/font/local` and a bundled font file |
| `{"error":"fetch failed"}` in an older build, or `{"error":"ECONNRESET reaching api.muapi.ai", "code": ..., "hint": ...}` | The **server** running the app cannot reach the upstream. The response names the cause code rather than hiding it behind `fetch failed` | Match the `code`: `ECONNRESET` → an egress firewall or TLS-intercepting proxy is resetting the connection, `ENOTFOUND` → DNS, `ECONNREFUSED` → nothing listening (a wrong `MUAPI_BASE_URL` looks like this), `UNABLE_TO_VERIFY_LEAF_SIGNATURE` → untrusted proxy certificate. Unblock the host where the app runs — a browser-side proxy will not help: all API calls are proxied server-side by design |
| Generation appears to hang and only fails 20–30 min later | The polling loop treats any `5xx` as transient and retries up to 900 times, 2 s apart, before surfacing anything | Confirm the upstream is reachable first (see `code` above). The long retry budget is deliberate for video jobs, but it also means a hard connectivity failure takes ~30 min to show up in the UI |
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
