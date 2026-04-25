# Local development quickstart

## Prerequisites

- Node.js 18+ (the project uses Next.js 15 App Router and `@google/genai` which require modern Node).
- npm (ships with Node).
- API keys for the providers you want to exercise. See `.env.example` for the full list. At minimum: `GEMINI_API_KEY`, `ANAM_API_KEY`, `ASSEMBLYAI_API_KEY`. `FIRECRAWL_API_KEY` unlocks external research and resource discovery.

## First-time setup

```bash
# from the project root
npm install
cp .env.example .env
# fill in keys in .env
```

If you forget to provide a key for a route you call, the server returns a clear error rather than silently misbehaving.

## Run the dev server

```bash
npm run dev
```

Defaults: `HOST=0.0.0.0`, `PORT=5000` (override via env). The single Node process serves both the Next.js frontend and the Express `/api/*` routes plus the WebSocket bridge at `/api/live`. Open `http://localhost:5000` in a browser.

Hot reload is on for the `app/` and `components/` trees (Next.js HMR). Server-side changes to `server.js` require a manual restart.

## Try a full session

1. Open `/` → click into `/agents`.
2. Pick an agent (Recruiter is the simplest starting point).
3. Create a thread, give it a title.
4. On the thread page: optionally upload a PDF (uses `/api/upload-deck`), optionally paste a company URL (uses `/api/agent-external-context`), name the session, click **Start session**.
5. Grant microphone permission. The avatar connects via Anam; you speak and see the user transcript appear; the avatar replies.
6. Click **End session** — evaluation runs in the background (`/api/evaluate-session`), then resources (`/api/session-resources`). When the page navigates to the session detail you'll see the score card populate within ~30s.
7. Run a second session in the same thread — thread evaluation auto-fires (`/api/evaluate-thread`) and writes `thread.memory.hiddenGuidance` so the next session's avatar steers without breaking realism.
8. From the session detail page, pick a baseline and click **Compare** to call `/api/compare-sessions`.

## Smoke-test the API surface

With the dev server running:

```bash
node scripts/smoke-all.mjs   # runs every per-endpoint smoke in parallel
```

Or hit one at a time:

```bash
node scripts/smoke-evaluate-session.mjs
node scripts/smoke-evaluate-thread.mjs
node scripts/smoke-compare-sessions.mjs
node scripts/smoke-session-resources.mjs
node scripts/smoke-upload-deck.mjs
node scripts/smoke-firecrawl.mjs
```

Override the target with `SPARK_HTTP_URL=http://host:port node scripts/smoke-X.mjs`.

For `smoke-upload-deck`, drop a real PDF at `scripts/fixtures/sample.pdf` to exercise the happy path. Without a fixture the script falls back to a route-mounted check (POST without a file, expect 400).

## Production-style local run

```bash
npm run build       # next build
npm run start       # NODE_ENV=production node server.js
```

## Where things live

| Thing | Path |
|---|---|
| Express + ws bootstrap, all `/api/*` handlers | `server.js` |
| Next.js routes (App Router) | `app/` |
| All React components | `components/` |
| Agent catalog (5 agents, full prompts) | `data/agents.js` |
| Helpers consumed by both server and client | `lib/` |
| Per-endpoint smoke tests | `scripts/` |
| Specs & implementation plans | `.kiro/specs/`, `docs/superpowers/plans/` |
| Steering docs (product/tech/structure) | `.kiro/steering/` |

## Common gotchas

- **`uploads/` directory** is required for `/api/upload-deck` (multer writes temp files there). Auto-created via `uploads/.gitkeep`.
- **localStorage key** is `simcoach-state-v1`. Clearing it resets all threads, sessions, evaluations, and theme.
- **WebSocket protocol** (`/api/live`) does not match the `start_session` / `user_transcript` shape some specs mention — see `docs/api.md` for the actual message types (`session_context`, `user_audio`, `model_text`, etc.).
- **Anam avatar** is randomly chosen per session-token request, so the same agent slug may render with different avatars across sessions.
