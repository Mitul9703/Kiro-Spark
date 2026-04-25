# Spark — System Design (brainstorm output)

**Date:** 2026-04-24
**Status:** Approved by user, decomposed into five Kiro feature specs.
**Working directory:** `/home/ashwanth/Documents/Projects/Kiro-Spark`

This document captures the cross-cutting design decisions reached during the brainstorming session. The detailed feature specs live under `.kiro/specs/<feature>/`. The cross-cutting steering rules live under `.kiro/steering/`.

## 1. Product

**Spark** is an AI-powered rehearsal platform. Users practice high-pressure communication scenarios (interviews, pitches, presentations, coding rounds) against live AI avatars and receive a detailed performance report afterward.

Five role-specific agents — Recruiter, Professor, Investor, Coding, Custom — each with their own system prompt, evaluation rubric, and screen-share/research behavior. The product is a single-user, single-device experience. No accounts, no DB. State lives in the browser.

End user goal: open the app, pick an agent, attach materials, run a 10-25 minute live voice/video rehearsal with an animated avatar, and get back a structured evaluation, multi-session progress tracking, improvement resources, and a side-by-side comparison against past runs.

## 2. Decisions

| Topic        | Decision                                                                                                                                | Why                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Spec model   | Five Kiro feature specs (one per area)                                                                                                  | Matches Kiro's spec-driven workflow; enables parallel implementation; each area has a distinct surface and contract |
| Language     | Plain JavaScript (`.js`)                                                                                                                | Fastest path to a 1:1 functional rebuild; no TS toolchain overhead                                                  |
| Framework    | Next.js 15 App Router + React 19                                                                                                        | Owns frontend; same process serves the Express backend                                                              |
| Backend      | Express 5 + `ws` (WebSocket) attached to the same HTTP server, wraps Next.js handler                                                    | Single-process deployment, WebSocket for live sessions                                                              |
| AI providers | Gemini Live (voice), Gemini 2.5-flash (batch), Anam (avatar), AssemblyAI (mic STT), Firecrawl (web search/scrape), LangChain ReAct loop | Same proven mix; user has all keys ready                                                                            |
| Persistence  | Browser localStorage only (`spark-state-v1`)                                                                                            | No DB, no auth — explicit YAGNI                                                                                     |
| Deployment   | Render Web Service (free plan)                                                                                                          | WebSocket-friendly, single-process, matches the architecture                                                        |
| Styling      | Single global stylesheet driven by CSS variables; dark/light theme                                                                      | No Tailwind, no styled-components — keeps the surface lean                                                          |
| Tests        | Manual QA + per-endpoint smoke scripts under `scripts/`                                                                                 | No test pyramid for a hackathon-class build                                                                         |

## 3. The five specs

| #   | Spec                     | One-line scope                                                                                         |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1   | `agents-and-threads`     | Routing, pages, agent catalog, thread CRUD, AppProvider state shape, theming, shell. Foundation.       |
| 2   | `live-session`           | `/session/[slug]` page, WS bridge, Gemini Live, Anam avatar, AssemblyAI mic, screen share, code editor |
| 3   | `evaluation-engine`      | Per-session and per-thread evaluation, hidden memory, async job tracking, evaluation UI                |
| 4   | `research-and-resources` | PDF upload + cleanup, pre-session external research, post-session resource discovery, ReAct agents     |
| 5   | `session-comparison`     | Two-session side-by-side metric delta + Gemini-generated insights                                      |

Each spec writes its own `requirements.md`, `design.md`, and `tasks.md` under `.kiro/specs/<spec>/`. Cross-spec contracts (the AppProvider state shape, agent config, session record) are owned by `agents-and-threads`; other specs add typed extensions in their own `design.md` under "Contract changes".

## 4. Top-level architecture

```
┌──────────── Browser ────────────┐
│  Next.js 15 (App Router)        │
│  React 19 + AppProvider         │
│  ↳ localStorage 'spark-state-v1'│
│  Anam SDK (avatar render)       │
│  AssemblyAI realtime (mic STT)  │
└───────────┬─────────────────────┘
            │ HTTP + WebSocket
┌───────────┴─────────────────────┐
│  Express 5 server.js            │
│  ↳ /api/*                       │
│  ↳ WS /api/live (ws library)    │
│  ↳ Next.js handler fallthrough  │
│  Modules: server/{anam,upload,  │
│   external-context,evaluation,  │
│   resources,comparison,         │
│   live-bridge,firecrawl}.js     │
└───────────┬─────────────────────┘
            │
   ┌────────┼─────────┬─────────┬───────────┐
 Gemini  Gemini       Anam      Assembly    Firecrawl
 Live   2.5-flash     SDK       AI realtime  search/scrape
```

## 5. Data flow

**Pre-session prep** (blocks the live session start):

1. PDF upload → `/api/upload-deck` → pdf-parse → Gemini cleanup → cleaned text returned.
2. "Start session" → `/api/agent-external-context` → ReAct loop (Firecrawl search + scrape, Gemini synth) → markdown brief; for `coding` agent it returns a `codingQuestion`.

**Live phase** (WebSocket lifecycle, single connection):

1. Client opens `WS /api/live?sessionId=&agentSlug=`.
2. Client sends `start_session` with grounded context (upload + research + customContext + thread `hiddenGuidance`).
3. Server creates Gemini Live session with model `gemini-2.5-flash-native-audio-preview-12-2025`, voice from the chosen Anam avatar profile.
4. User mic → AssemblyAI realtime → finalized chunks → `user_transcript` to server → forwarded to Gemini.
5. Gemini Live audio → forwarded to Anam SDK on client → avatar renders with lip-sync.
6. Gemini text → `transcript` event to client → appended to transcript log.
7. Coding sessions: keystroke debounce → `code_snapshot` to server → forwarded as system note to Gemini.
8. Screen share: 500ms JPEG sampling → `screen_frame` → forwarded as inline image input to Gemini.
9. Mute / end → `mute` / close → server cleans up.

**Post-session** (background, AbortController-tracked):

1. AppProvider effect: any session with a transcript and `evaluation.status === 'idle'` triggers `/api/evaluate-session`.
2. On completion, if the parent thread has ≥2 completed sessions, trigger `/api/evaluate-thread` and apply the resulting `memory.hiddenGuidance` to the thread (used by the next live session).
3. From the evaluation's `resourceBriefs`, trigger `/api/session-resources` (Firecrawl ReAct).
4. User-initiated: `/api/compare-sessions` against a chosen baseline.

## 6. State model

A single React context (`AppProvider`) holds the full state, keyed by agent slug:

```
state = {
  theme,
  toasts: [],
  agents: { [slug]: { upload, sessionName, threadName, customContextText,
                      companyUrl, researchPrep, selectedThreadId, session,
                      evaluation, rating } },
  threads: { [slug]: [{ id, title, createdAt, updatedAt, sessionIds,
                        evaluation, memory }] },
  sessions: { [slug]: [{ id, threadId, sessionName, startedAt, endedAt,
                         durationLabel, transcript, upload, externalResearch,
                         coding, customContext, evaluation, resources,
                         comparison }] }
}
```

Persistence is to localStorage under `spark-state-v1`, debounced. Async jobs use a `useRef(new Map())` of `jobKey → AbortController`.

## 7. Error handling

- Missing API keys: server checks at call time and returns `{error: descriptive message}` with 500. Frontend surfaces via toast.
- WebSocket disconnect: ends the session and triggers eval flow; no auto-reconnect.
- LLM JSON malformed: each endpoint normalizes via a Zod-like coercer; falls back to safe defaults.
- ReAct loop runaway: hard cap iterations at 6.
- localStorage corruption: trapped on read, falls back to default state.
- PDF parse failure: returns 400 with detail; temp file deleted in `finally`.

## 8. Testing

- No automated test framework. Manual QA flows are documented in each spec's `tasks.md`.
- Per-endpoint smoke scripts under `scripts/smoke-*.mjs` post a fixture and assert response shape. These act as the regression suite.

## 9. What's next

- Five spec-writing agents wrote `requirements.md`, `design.md`, `tasks.md` for each of the feature areas in parallel.
- Spec self-review pass to fix placeholders, contradictions, and ambiguity.
- User reviews the committed specs.
- Brainstorming hands off to the `superpowers:writing-plans` skill, which produces detailed implementation plans (one per spec) before any code is written.
