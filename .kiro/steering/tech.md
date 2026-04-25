# Tech Steering — Spark

## Runtime & language

- **Node.js 18+** (LTS).
- **Plain JavaScript** (`.js` for both Node and JSX). No TypeScript.
- **npm** as package manager.

## Stack

### Frontend
- **Next.js 15** (App Router) — `^15.3.1`. Pages live under `app/`.
- **React 19** — `^19.1.0`. Function components, hooks. No class components.
- **CSS** — single global stylesheet at `app/globals.css` driven by CSS custom properties for theming. No Tailwind, no styled-components, no CSS modules. Inline `className` strings only.
- **CodeMirror 6** via `@uiw/react-codemirror@^4.25.8` plus `@codemirror/lang-javascript|python|java|cpp|sql` for the coding agent.
- **Anam JS SDK** — `@anam-ai/js-sdk@^4.12.0` for avatar rendering and audio passthrough lip-sync.
- **AssemblyAI SDK** — `assemblyai@^4.28.0` for client-side realtime user mic transcription.
- **Buffer polyfill** — `buffer@^6.0.3` for browser-side base64 work.

### Backend (same `package.json`, single process)
- **Express 5** — `^5.2.1`. Wraps the Next.js handler and adds `/api/*` routes.
- **ws** — `^8.19.0`. WebSocket server attached to the same HTTP server, mounted at `/api/live`.
- **multer** — `^2.1.1`. PDF upload handling to a `uploads/` temp dir; files deleted in `finally` after parse.
- **pdf-parse** — `^2.4.5`. Extract text from uploaded PDFs.
- **CORS** — `cors@^2.8.6`. Enabled globally because the WS handshake comes from the same origin but third-party SDKs may add cross-origin XHRs.
- **dotenv** — `^17.3.1`. Loaded at process start; required envs validated lazily at first use.
- **cross-env** — `^10.1.0`. Used in npm scripts for portable env var setting.

### AI providers
- **Gemini** via `@google/genai@^1.46.0`.
  - Live model: `gemini-2.5-flash-native-audio-preview-12-2025` for the realtime voice session.
  - Generation model: `gemini-2.5-flash` for evaluations, comparisons, research synthesis, PDF context cleanup.
- **LangChain** — `langchain@^1.3.0` plus `@langchain/google-genai@^2.1.26` and `@langchain/core` for the ReAct-style research agent (search → scrape → synthesize).
- **Zod** — `^4.3.6` for tool schema validation inside LangChain agents and for normalizing LLM JSON output.
- **Firecrawl** via plain HTTP (no SDK):
  - `POST https://api.firecrawl.dev/v1/search`
  - `POST https://api.firecrawl.dev/v2/scrape`

## Environment variables

Every variable is optional at process start; presence is checked at the call site so the server can boot even with partial keys.

```
# Server
NODE_ENV=development|production
HOST=0.0.0.0
PORT=3000

# Gemini — fall back to GEMINI_API_KEY if a per-purpose key is absent
GEMINI_API_KEY
GEMINI_LIVE_API_KEY
GEMINI_QUESTION_FINDER_API_KEY
GEMINI_EVALUATION_API_KEY
GEMINI_RESOURCE_CURATION_API_KEY
GEMINI_UPLOAD_PREP_API_KEY

# Avatar
ANAM_API_KEY

# Transcription
ASSEMBLYAI_API_KEY

# Web research
FIRECRAWL_API_KEY

# Frontend (NEXT_PUBLIC_* — exposed at build)
NEXT_PUBLIC_BACKEND_HTTP_URL
NEXT_PUBLIC_BACKEND_WS_URL
```

A `.env.example` lists all of these with empty values.

## Deployment

**Render** (Web Service, free plan).

```yaml
services:
  - type: web
    name: spark
    runtime: node
    plan: free
    buildCommand: npm install && npm run build
    startCommand: npm run start
    healthCheckPath: /api/health
    envVars:
      - NODE_ENV: production
      - GEMINI_API_KEY: { sync: false }
      - ANAM_API_KEY: { sync: false }
      - ASSEMBLYAI_API_KEY: { sync: false }
      - FIRECRAWL_API_KEY: { sync: false }
```

## Conventions

- **File names**: kebab-case for components and routes (`agent-detail-page.js`).
- **Component names**: PascalCase (`AgentDetailPage`).
- **API routes**: `/api/<resource>-<action>` (`/api/upload-deck`, `/api/evaluate-session`).
- **IDs**: `${type}-${Date.now()}-${random8hex}` (`thread-1735000000000-a1b2c3d4`).
- **Errors**: API responds `{ error: string, details?: any }` with appropriate 4xx/5xx. Frontend catches, surfaces via toast.
- **Async jobs**: Tracked client-side in a `useRef(new Map())` of `jobKey → AbortController`; status enum `idle|processing|completed|failed`.
- **No structured logger** — `console.log`/`console.error` are fine.
- **No tests directory** — write `scripts/smoke-*.mjs` per endpoint as the regression check.
- **Comments**: only when the *why* is non-obvious. Default to none.

## Forbidden

- TypeScript (`.ts`, `.tsx`, `tsconfig.json`).
- Tailwind, styled-components, CSS modules.
- A persistent database (Postgres, SQLite, MongoDB, Redis, etc.).
- Auth providers (Clerk, NextAuth, Auth0).
- Docker / docker-compose.
- Any provider not listed above without explicit user approval.
