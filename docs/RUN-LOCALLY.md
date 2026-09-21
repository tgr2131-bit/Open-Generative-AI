# Running Open Generative AI locally (real generations)

Zero to real generations on your own machine, in about five minutes.

This is the path when you want **actual output** from the models. (If all you need
is to click around the UI, the repo also ships a mock upstream — see
[Fake output](#fake-output-and-the-amber-banner).)

## What you need

- **Node.js 18+** and **git**
- A network that can reach `registry.npmjs.org` (install) and **`api.muapi.ai`** (generation)
- A **Muapi access key**: <https://muapi.ai/access-keys>
- Muapi credits on that account — generation is billed per call

> **The machine running the server needs `api.muapi.ai`, not your browser.** The app
> proxies every API call server-side through its own `/api/*` routes, so the
> browser never talks to Muapi directly. If you run this on a locked-down box,
> that box is the one that must have egress — a browser-side proxy will not help.

## 1. Get the code

```bash
git clone --recurse-submodules https://github.com/Anil-matcha/Open-Generative-AI.git
cd Open-Generative-AI
```

Already cloned without `--recurse-submodules`? The setup step below repairs it.

## 2. Install

```bash
npm run setup:local
```

This initializes the three submodules, installs dependencies, and builds the
workspace packages. It falls back instead of aborting when a pinned submodule
commit no longer exists upstream or when Electron's binary cannot be downloaded —
neither of which affects the web app.

Strict alternative: `npm run setup` (fails fast instead of falling back).

## 3. Start it

```bash
npm run dev
```

Open <http://localhost:3000> — it redirects to `/studio`.

## 4. Add your API key

The app asks for a key on first use. Paste the **key value** from
<https://muapi.ai/access-keys> — not the key's name or label. It is kept in your
browser's `localStorage` and sent as the `x-api-key` header through this app's own
routes, so it never appears in the page source.

Your USD balance then shows in the header. Generate something in **Image Studio**
and it comes back from the real API.

### Or supply one key for the whole instance

Useful for a shared box or a self-hosted deployment — no visitor is prompted:

```bash
MUAPI_API_KEY=your-key npm run dev
```

The server attaches that key to outbound calls for anyone who has not brought
their own; a visitor who pastes their own key overrides it for their session.
It is read at request time, so `next start` picks it up from its own environment
with no rebuild. **Settings** shows `Provided by this deployment` while it is in
use.

## Verify it is really talking to Muapi

```bash
curl -s localhost:3000/api/config
# {"serverApiKey":false,"upstream":"https://api.muapi.ai","customUpstream":false}

curl -s -H "x-api-key: $YOUR_KEY" localhost:3000/api/api/v1/account/balance
# {"balance":...}
```

`upstream` must read `https://api.muapi.ai` and `customUpstream` must be `false`.
If `customUpstream` is `true`, something has pointed the app at a different host —
see below.

## Production build

```bash
npm run build && npm start
```

Two things that bite here:

- **`npm run build` needs `fonts.googleapis.com`.** `next/font` fetches Inter at
  build time and fails the build outright when it cannot, unlike `npm run dev`,
  which only warns and falls back. Build on a machine with access, or switch
  `app/layout.js` to `next/font/local` with a bundled font.
- The build must be produced on the same platform you run it on.

### Docker

A `docker-compose.yml` is included and publishes the app on **port 3001**:

```bash
MUAPI_API_KEY=your-key docker compose up --build
# then http://localhost:3001
```

The image runs the production build, so the Google Fonts caveat above applies to
the build stage.

## Fake output and the amber banner

The repo ships a mock upstream (`npm run mock:muapi`) for environments that cannot
reach Muapi — CI containers, sandboxes, locked-down networks. It implements
submit/poll/balance/upload and returns **self-describing SVG placeholders** so the
UI can be worked on offline.

Whenever the app is pointed at anything other than the real API, an **amber
banner** appears in the bottom-left corner naming the host it is actually calling
and stating that results are not real generations. So:

- **Banner visible** → you are on a stub or gateway; output is not a real
  generation.
- **No banner** → you are talking to `api.muapi.ai`.

If you see the banner and did not intend it, clear the override and restart:

```bash
unset MUAPI_BASE_URL
npm run dev
```

## Troubleshooting

Most install and runtime problems are covered in
[SETUP.md](./SETUP.md#troubleshooting), including the submodule pin error, the
Electron binary failing to download, and the Google Fonts build failure.

Generation-specific:

| Symptom | Meaning |
|---|---|
| `ECONNRESET reaching api.muapi.ai` | The **server** cannot reach Muapi — egress firewall, VPN, or proxy. Move the app to a machine that can, or unblock the host |
| `ENOTFOUND reaching api.muapi.ai` | DNS failure on the server |
| `ECONNREFUSED` | Nothing listening — usually a wrong `MUAPI_BASE_URL` |
| `401` / `403` in the UI, key prompt reappears | The key is wrong, revoked, or has no credits. Paste the key *value*, not its name |
| Generation seems to hang, then fails ~30 min later | The polling loop retries any `5xx` up to 900 times at 2 s intervals. Check the upstream is reachable before assuming a model problem |
