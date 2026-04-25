# Structure Steering — Spark

## Repo layout

```
/
├── .kiro/                              # Spec-driven dev artifacts
│   ├── steering/
│   │   ├── product.md
│   │   ├── tech.md
│   │   └── structure.md                # this file
│   └── specs/
│       ├── agents-and-threads/         { requirements, design, tasks }.md
│       ├── live-session/               { requirements, design, tasks }.md
│       ├── evaluation-engine/          { requirements, design, tasks }.md
│       ├── research-and-resources/     { requirements, design, tasks }.md
│       └── session-comparison/         { requirements, design, tasks }.md
├── app/                                # Next.js App Router
│   ├── layout.js                       # Root layout, metadata, AppProvider mount
│   ├── page.js                         # Landing → renders <LandingPage/>
│   ├── globals.css                     # Theme variables, all component styles
│   ├── agents/
│   │   ├── page.js                     # /agents → <AgentsPage/>
│   │   └── [slug]/
│   │       ├── page.js                 # /agents/:slug → <AgentDetailPage/>
│   │       ├── threads/[threadId]/page.js
│   │       └── sessions/[sessionId]/page.js
│   └── session/[slug]/page.js          # /session/:slug → <SessionPage/> (live)
├── components/                         # All React components live here
│   ├── app-provider.js                 # AppContext + state machine + localStorage sync
│   ├── shell.js                        # Common header / theme toggle / toast host
│   ├── landing-page.js
│   ├── agents-page.js
│   ├── agent-detail-page.js
│   ├── thread-detail-page.js
│   ├── session-page.js                 # The big one — live session orchestrator
│   └── session-detail-page.js
├── lib/                                # Pure-ish helpers and shared config
│   ├── agents.js                       # Agent slug → config lookup; re-exports data/agents.json
│   ├── client-config.js                # Resolve backend HTTP/WS URLs at runtime
│   ├── ids.js                          # ID generator
│   └── format.js                       # Time/duration formatting
├── data/
│   ├── agents.json                     # Canonical agent configs (5 entries)
│   └── agents.js                       # Default-export wrapper around agents.json
├── server/                             # Backend modules imported by server.js
│   ├── live-bridge.js                  # WS ↔ Gemini Live ↔ frame sampler
│   ├── upload.js                       # PDF upload + parse + LLM cleanup
│   ├── anam.js                         # Anam session token issuer
│   ├── external-context.js             # ReAct research agent (Firecrawl + Gemini)
│   ├── evaluation.js                   # Per-session and per-thread evaluators
│   ├── comparison.js                   # Session comparison
│   ├── resources.js                    # Resource discovery
│   └── firecrawl.js                    # Thin Firecrawl HTTP wrapper
├── scripts/                            # Smoke checks & dev utilities
│   └── smoke-*.mjs
├── server.js                           # Express + ws + Next.js handler bootstrap
├── next.config.mjs
├── package.json
├── render.yaml
├── .env.example
└── .gitignore
```

## Module boundaries

- **`app/`** is routing only. Each `page.js` imports a named component from `components/` and forwards URL params. Keep page files under ~30 lines.
- **`components/`** owns all UI. Components consume context via `useAppState()`/`useAppActions()` from `app-provider.js`. Components must not call `fetch` for the same data twice — the provider owns API orchestration.
- **`lib/`** is pure helpers. No imports from `components/` or `server/`.
- **`server/`** is backend modules. Each file exports a function that takes `(req, res)` (Express handler) or a higher-order init function (e.g. `attachLiveBridge(httpServer)`). No imports from `components/`, `app/`, or `lib/` (except for shared constants like `lib/agents.js`).
- **`server.js`** is the bootstrap. It loads dotenv, builds the Express app, wires `/api/*` to handlers in `server/`, attaches the WS server, and delegates everything else to the Next.js handler.

## State management

- A single React context (`AppProvider`) holds **all** client state.
- State is keyed by agent slug at the top level: `state.agents[slug]`, `state.threads[slug]`, `state.sessions[slug]`.
- Every state change is mirrored to localStorage under the key `spark-state-v1` via a debounced effect.
- Async jobs (evaluation, research, resources, comparison) are tracked with a `useRef(new Map())` of `jobKey → AbortController` and an effect that auto-triggers any session whose `evaluation.status === 'idle'` once it has a transcript.

## API surface

Every backend endpoint is a single Express handler module under `server/`, mounted in `server.js`. Endpoints are stateless. WebSocket is the only stateful connection.

```
GET    /api/health                              → liveness probe
POST   /api/anam-session-token                  → issue Anam session token
POST   /api/upload-deck (multipart)             → PDF → cleaned text
POST   /api/agent-external-context              → ReAct research result
POST   /api/evaluate-session                    → per-session evaluation
POST   /api/evaluate-thread                     → cross-session thread evaluation
POST   /api/compare-sessions                    → metric-delta comparison
POST   /api/session-resources                   → resource discovery from briefs
WS     /api/live?sessionId=&agentSlug=          → live session bridge
```

## Naming

- Pages: `kebab-case-page.js` exporting `KebabCasePage`.
- Server modules: lowercase noun (`evaluation.js`, `firecrawl.js`).
- Functions: camelCase verbs (`evaluateSession`, `attachLiveBridge`).
- Constants: SCREAMING_SNAKE for primitives, camelCase for config objects.

## Cross-spec dependencies

Specs are written independently but share these contracts:

1. **Agent config shape** (`data/agents.json`) — owned by `agents-and-threads`, consumed by all four others.
2. **AppProvider state shape** (`components/app-provider.js`) — owned by `agents-and-threads`, extended by:
   - `live-session` adds `state.agents[slug].session`, transcript writes
   - `evaluation-engine` adds `state.sessions[slug][i].evaluation` and `state.threads[slug][j].evaluation`/`memory`
   - `research-and-resources` adds `state.agents[slug].researchPrep` and `state.sessions[slug][i].resources`
   - `session-comparison` adds `state.sessions[slug][i].comparison`
3. **Session record shape** — defined in `agents-and-threads` `design.md`, extended by other specs.

When a spec extends a contract, the extension is documented in that spec's `design.md` under a "Contract changes" section.
