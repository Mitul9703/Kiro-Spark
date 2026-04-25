# Agents and Threads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational layer of Spark — routing, pages, agent catalog, AppProvider state, theming, shell — that every other spec extends.

**Architecture:** Next.js 15 App Router pages forward URL params into named components under `components/`; a single React context (`AppProvider`) holds all client state, persists to localStorage, and exposes mutators via `useAppActions()`. No backend work in this plan.

**Tech Stack:** Next.js 15, React 19, plain JavaScript, CSS variables (no Tailwind), localStorage persistence.

---

## File Map

### Project bootstrap

- `package.json` — npm scripts and React 19 / Next 15 dependencies for this feature.
- `next.config.mjs` — Empty App Router config.
- `.gitignore` — Node/Next exclusions.
- `.env.example` — Empty stubs for later specs (documented in tech.md).
- `app/layout.js` — Root HTML shell; mounts `<AppProvider>`.
- `app/globals.css` — Theme variables, global resets, component styles.

### Shared libraries

- `lib/ids.js` — `generateId(type)` helper.
- `lib/format.js` — `formatDuration`, `formatDateTime`.
- `lib/client-config.js` — Resolves backend URLs at runtime (stub for later specs).
- `lib/agents.js` — Exports `agents` array, `agentBySlug`, `agentSlugs`.

### Data

- `data/agents.json` — The five canonical agent configs, fully populated.
- `data/agents.js` — Re-export wrapper around `agents.json`.

### State container

- `components/app-provider.js` — Context, reducer, mutators, localStorage sync.

### Shared chrome

- `components/shell.js` — Header, theme toggle, toast host, main content frame.

### Pages

- `components/landing-page.js` — Hero + three-step flow.
- `components/agents-page.js` — Directory of 5 agent cards.
- `components/agent-detail-page.js` — Scenario, rubric, thread CRUD.
- `components/thread-detail-page.js` — Pre-session form + sessions history.

### App Router

- `app/page.js` — Renders `<LandingPage/>` in `<Shell>`.
- `app/agents/page.js` — Renders `<AgentsPage/>`.
- `app/agents/[slug]/page.js` — Renders `<AgentDetailPage slug/>`.
- `app/agents/[slug]/threads/[threadId]/page.js` — Renders `<ThreadDetailPage slug threadId/>`.
- `app/agents/[slug]/sessions/[sessionId]/page.js` — Stub placeholder (owned by: evaluation-engine).
- `app/session/[slug]/page.js` — Stub placeholder (owned by: live-session).

### Smoke / QA

- `scripts/smoke-agents-catalog.mjs` — Verifies catalog invariants from Requirement 11.

---

## Tasks

### Task 1: Scaffold the Next.js 15 app

**Files:** `package.json`, `next.config.mjs`, `.gitignore`, `.env.example`

Bootstrap a minimum Next.js 15 / React 19 project with no extra deps yet (backend and SDK deps land in other specs).

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/package.json`:

  ```json
  {
    "name": "spark",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "lint": "next lint",
      "smoke:agents": "node scripts/smoke-agents-catalog.mjs"
    },
    "dependencies": {
      "next": "^15.3.1",
      "react": "^19.1.0",
      "react-dom": "^19.1.0"
    },
    "devDependencies": {
      "eslint": "^9.0.0",
      "eslint-config-next": "^15.3.1"
    }
  }
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/next.config.mjs`:

  ```js
  /** @type {import('next').NextConfig} */
  const nextConfig = {};
  export default nextConfig;
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/.gitignore`:

  ```
  node_modules/
  .next/
  out/
  .env
  .env.local
  uploads/
  *.log
  .DS_Store
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/.env.example`:

  ```
  # Server
  NODE_ENV=development
  HOST=0.0.0.0
  PORT=3000

  # Gemini
  GEMINI_API_KEY=
  GEMINI_LIVE_API_KEY=
  GEMINI_QUESTION_FINDER_API_KEY=
  GEMINI_EVALUATION_API_KEY=
  GEMINI_RESOURCE_CURATION_API_KEY=
  GEMINI_UPLOAD_PREP_API_KEY=

  # Avatar
  ANAM_API_KEY=

  # Transcription
  ASSEMBLYAI_API_KEY=

  # Web research
  FIRECRAWL_API_KEY=

  # Frontend
  NEXT_PUBLIC_BACKEND_HTTP_URL=
  NEXT_PUBLIC_BACKEND_WS_URL=
  ```

- [ ] Run `npm install` in the repo root; verify `node_modules/` appears and no errors are reported.

- [ ] Verification — run `npx next --version` and confirm output starts with `15.`.

- [ ] Commit:
  ```sh
  git add package.json next.config.mjs .gitignore .env.example package-lock.json
  git commit -m "chore: scaffold next.js 15 project with react 19"
  ```

---

### Task 2: Add shared `lib/` helpers

**Files:** `lib/ids.js`, `lib/format.js`, `lib/client-config.js`

Pure helpers for IDs, time formatting, and runtime URL resolution. Used by AppProvider and pages.

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/lib/ids.js`:

  ```js
  function random8hex() {
    if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
      const bytes = new Uint8Array(4);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
    return Math.random().toString(16).slice(2, 10).padStart(8, "0");
  }

  export function generateId(type) {
    return `${type}-${Date.now()}-${random8hex()}`;
  }
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/lib/format.js`:

  ```js
  export function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  export function formatDateTime(iso) {
    if (typeof iso !== "string" || iso.length === 0) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  }
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/lib/client-config.js`:

  ```js
  export function getBackendHttpUrl() {
    if (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_BACKEND_HTTP_URL) {
      return process.env.NEXT_PUBLIC_BACKEND_HTTP_URL;
    }
    if (typeof window !== "undefined") return window.location.origin;
    return "";
  }

  export function getBackendWsUrl() {
    if (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_BACKEND_WS_URL) {
      return process.env.NEXT_PUBLIC_BACKEND_WS_URL;
    }
    if (typeof window !== "undefined") {
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${scheme}//${window.location.host}`;
    }
    return "";
  }
  ```

- [ ] Verification — create a temporary node REPL (or inline in a scratch file) and confirm:
  - `generateId('thread')` returns a string like `thread-1745…-xxxxxxxx`.
  - `formatDuration(125000)` returns `"02:05"`; `formatDuration(-1)` returns `"00:00"`.
  - `formatDateTime('2026-04-24T15:14:00Z')` returns a non-empty string; `formatDateTime('bad')` returns `""`.

- [ ] Commit:
  ```sh
  git add lib/ids.js lib/format.js lib/client-config.js
  git commit -m "feat(lib): add id, format, and client-config helpers"
  ```

---

### Task 3: AppProvider scaffold (no persistence yet)

**Files:** `components/app-provider.js`

Build the reducer, default state, mutators, and context hooks. Persistence comes in Task 4.

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/components/app-provider.js`:

  ```js
  "use client";

  import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
  import { generateId } from "../lib/ids.js";

  const ACTIONS = {
    HYDRATE: "HYDRATE",
    SET_THEME: "SET_THEME",
    PUSH_TOAST: "PUSH_TOAST",
    DISMISS_TOAST: "DISMISS_TOAST",
    PATCH_AGENT: "PATCH_AGENT",
    CREATE_THREAD: "CREATE_THREAD",
    DELETE_THREAD: "DELETE_THREAD",
    PATCH_THREAD: "PATCH_THREAD",
    CREATE_SESSION: "CREATE_SESSION",
    DELETE_SESSION: "DELETE_SESSION",
    PATCH_SESSION: "PATCH_SESSION",
    APPEND_TRANSCRIPT: "APPEND_TRANSCRIPT",
  };

  export const defaultAgentSlice = () => ({
    upload: { status: "idle", fileName: null, contextText: "", previewUrl: null, error: null },
    sessionName: "",
    threadName: "",
    customContextText: "",
    companyUrl: "",
    researchPrep: null,
    selectedThreadId: null,
    session: { status: "idle", muted: false, lastEndedAt: null, lastDurationLabel: null },
    evaluation: null,
    rating: 0,
  });

  export const defaultState = {
    theme: "dark",
    toasts: [],
    agents: {},
    threads: {},
    sessions: {},
  };

  function ensureAgent(state, slug) {
    if (state.agents[slug]) return state;
    return { ...state, agents: { ...state.agents, [slug]: defaultAgentSlice() } };
  }

  function reducer(state, action) {
    switch (action.type) {
      case ACTIONS.HYDRATE:
        return action.state;
      case ACTIONS.SET_THEME:
        return { ...state, theme: action.theme };
      case ACTIONS.PUSH_TOAST: {
        const { id, message, kind } = action.toast;
        return { ...state, toasts: [...state.toasts, { id, message, kind }] };
      }
      case ACTIONS.DISMISS_TOAST:
        return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
      case ACTIONS.PATCH_AGENT: {
        const base = ensureAgent(state, action.slug);
        const prev = base.agents[action.slug];
        return {
          ...base,
          agents: { ...base.agents, [action.slug]: { ...prev, ...action.patch } },
        };
      }
      case ACTIONS.CREATE_THREAD: {
        const list = state.threads[action.slug] || [];
        return {
          ...state,
          threads: { ...state.threads, [action.slug]: [...list, action.thread] },
        };
      }
      case ACTIONS.DELETE_THREAD: {
        const list = state.threads[action.slug] || [];
        const remainingThreads = list.filter((t) => t.id !== action.threadId);
        const sessionList = state.sessions[action.slug] || [];
        const remainingSessions = sessionList.filter((s) => s.threadId !== action.threadId);
        return {
          ...state,
          threads: { ...state.threads, [action.slug]: remainingThreads },
          sessions: { ...state.sessions, [action.slug]: remainingSessions },
        };
      }
      case ACTIONS.PATCH_THREAD: {
        const list = state.threads[action.slug] || [];
        return {
          ...state,
          threads: {
            ...state.threads,
            [action.slug]: list.map((t) =>
              t.id === action.threadId ? { ...t, ...action.patch } : t,
            ),
          },
        };
      }
      case ACTIONS.CREATE_SESSION: {
        const sessions = state.sessions[action.slug] || [];
        const threads = state.threads[action.slug] || [];
        return {
          ...state,
          sessions: { ...state.sessions, [action.slug]: [...sessions, action.session] },
          threads: {
            ...state.threads,
            [action.slug]: threads.map((t) =>
              t.id === action.session.threadId
                ? {
                    ...t,
                    sessionIds: [...t.sessionIds, action.session.id],
                    updatedAt: action.session.startedAt,
                  }
                : t,
            ),
          },
        };
      }
      case ACTIONS.DELETE_SESSION: {
        const sessions = state.sessions[action.slug] || [];
        const target = sessions.find((s) => s.id === action.sessionId);
        const threads = state.threads[action.slug] || [];
        return {
          ...state,
          sessions: {
            ...state.sessions,
            [action.slug]: sessions.filter((s) => s.id !== action.sessionId),
          },
          threads: target
            ? {
                ...state.threads,
                [action.slug]: threads.map((t) =>
                  t.id === target.threadId
                    ? { ...t, sessionIds: t.sessionIds.filter((id) => id !== action.sessionId) }
                    : t,
                ),
              }
            : state.threads,
        };
      }
      case ACTIONS.PATCH_SESSION: {
        const sessions = state.sessions[action.slug] || [];
        return {
          ...state,
          sessions: {
            ...state.sessions,
            [action.slug]: sessions.map((s) =>
              s.id === action.sessionId ? { ...s, ...action.patch } : s,
            ),
          },
        };
      }
      case ACTIONS.APPEND_TRANSCRIPT: {
        const sessions = state.sessions[action.slug] || [];
        return {
          ...state,
          sessions: {
            ...state.sessions,
            [action.slug]: sessions.map((s) =>
              s.id === action.sessionId ? { ...s, transcript: [...s.transcript, action.entry] } : s,
            ),
          },
        };
      }
      default:
        return state;
    }
  }

  const StateContext = createContext(defaultState);
  const ActionsContext = createContext(null);

  export function AppProvider({ children }) {
    const [state, dispatch] = useReducer(reducer, defaultState);
    const stateRef = useRef(state);
    stateRef.current = state;

    // reserved for future specs
    const jobsRef = useRef(new Map());
    const autoTriggerRef = useRef(new Set());

    const setTheme = useCallback((theme) => {
      dispatch({ type: ACTIONS.SET_THEME, theme });
    }, []);

    const pushToast = useCallback(({ message, kind = "info" } = {}) => {
      if (!message) return null;
      const id = generateId("toast");
      dispatch({ type: ACTIONS.PUSH_TOAST, toast: { id, message, kind } });
      return id;
    }, []);

    const dismissToast = useCallback((id) => {
      dispatch({ type: ACTIONS.DISMISS_TOAST, id });
    }, []);

    const patchAgent = useCallback((slug, patch) => {
      if (!slug) {
        console.warn("patchAgent: missing slug");
        return;
      }
      dispatch({ type: ACTIONS.PATCH_AGENT, slug, patch });
    }, []);

    const createThread = useCallback((slug, title) => {
      if (!slug || !title || !title.trim()) {
        console.warn("createThread: invalid args");
        return null;
      }
      const now = new Date().toISOString();
      const thread = {
        id: generateId("thread"),
        agentSlug: slug,
        title: title.trim(),
        createdAt: now,
        updatedAt: now,
        sessionIds: [],
        evaluation: null,
        memory: null,
      };
      dispatch({ type: ACTIONS.CREATE_THREAD, slug, thread });
      return thread.id;
    }, []);

    const deleteThread = useCallback((slug, threadId) => {
      const list = stateRef.current.threads[slug] || [];
      if (!list.some((t) => t.id === threadId)) {
        console.warn("deleteThread: thread not found");
        return;
      }
      dispatch({ type: ACTIONS.DELETE_THREAD, slug, threadId });
    }, []);

    const patchThread = useCallback((slug, threadId, patch) => {
      const list = stateRef.current.threads[slug] || [];
      if (!list.some((t) => t.id === threadId)) {
        console.warn("patchThread: thread not found");
        return;
      }
      dispatch({ type: ACTIONS.PATCH_THREAD, slug, threadId, patch });
    }, []);

    const createSession = useCallback((slug, threadId, partial = {}) => {
      const threads = stateRef.current.threads[slug] || [];
      if (!threads.some((t) => t.id === threadId)) {
        console.warn("createSession: thread not found");
        return null;
      }
      const now = new Date().toISOString();
      const session = {
        id: generateId("session"),
        agentSlug: slug,
        threadId,
        sessionName: partial.sessionName || "Untitled session",
        startedAt: now,
        endedAt: null,
        durationLabel: null,
        transcript: [],
        upload: partial.upload || null,
        externalResearch: null,
        coding: null,
        customContext: partial.customContext || "",
        evaluation: null,
        resources: null,
        comparison: null,
      };
      dispatch({ type: ACTIONS.CREATE_SESSION, slug, session });
      return session.id;
    }, []);

    const deleteSession = useCallback((slug, sessionId) => {
      const list = stateRef.current.sessions[slug] || [];
      if (!list.some((s) => s.id === sessionId)) {
        console.warn("deleteSession: session not found");
        return;
      }
      dispatch({ type: ACTIONS.DELETE_SESSION, slug, sessionId });
    }, []);

    const patchSession = useCallback((slug, sessionId, patch) => {
      const list = stateRef.current.sessions[slug] || [];
      if (!list.some((s) => s.id === sessionId)) {
        console.warn("patchSession: session not found");
        return;
      }
      dispatch({ type: ACTIONS.PATCH_SESSION, slug, sessionId, patch });
    }, []);

    const appendTranscript = useCallback((slug, sessionId, entry) => {
      const list = stateRef.current.sessions[slug] || [];
      if (!list.some((s) => s.id === sessionId)) {
        console.warn("appendTranscript: session not found");
        return;
      }
      dispatch({ type: ACTIONS.APPEND_TRANSCRIPT, slug, sessionId, entry });
    }, []);

    const actions = useMemo(
      () => ({
        setTheme,
        pushToast,
        dismissToast,
        patchAgent,
        createThread,
        deleteThread,
        patchThread,
        createSession,
        deleteSession,
        patchSession,
        appendTranscript,
        _jobsRef: jobsRef,
        _autoTriggerRef: autoTriggerRef,
      }),
      [
        setTheme,
        pushToast,
        dismissToast,
        patchAgent,
        createThread,
        deleteThread,
        patchThread,
        createSession,
        deleteSession,
        patchSession,
        appendTranscript,
      ],
    );

    return (
      <StateContext.Provider value={state}>
        <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
      </StateContext.Provider>
    );
  }

  export function useAppState() {
    return useContext(StateContext);
  }

  export function useAppActions() {
    const ctx = useContext(ActionsContext);
    if (!ctx) throw new Error("useAppActions must be used inside <AppProvider>");
    return ctx;
  }
  ```

- [ ] Verification (deferred to end-to-end QA in later tasks) — this scaffold compiles only; no UI yet.

- [ ] Commit:
  ```sh
  git add components/app-provider.js
  git commit -m "feat(state): add AppProvider reducer and mutator hooks"
  ```

---

### Task 4: Add localStorage persistence and theme mirror

**Files:** `components/app-provider.js`

Wire up hydrate-on-mount, debounced writes, and `data-theme` sync. This must be SSR-safe.

- [ ] Open `components/app-provider.js` and add imports at the top:

  ```js
  import { useEffect } from "react";
  ```

  (merge with existing `react` import so it becomes `import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';`)

- [ ] Add near the top of the file (above `AppProvider`):

  ```js
  const STORAGE_KEY = "spark-state-v1";

  function tryRestore() {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (err) {
      console.warn("spark-state-v1 corrupt, resetting", err);
      return null;
    }
  }

  function mergeRestored(base, restored) {
    if (!restored) return base;
    return {
      theme: restored.theme === "light" || restored.theme === "dark" ? restored.theme : base.theme,
      toasts: Array.isArray(restored.toasts) ? restored.toasts : base.toasts,
      agents:
        restored.agents && typeof restored.agents === "object" ? restored.agents : base.agents,
      threads:
        restored.threads && typeof restored.threads === "object" ? restored.threads : base.threads,
      sessions:
        restored.sessions && typeof restored.sessions === "object"
          ? restored.sessions
          : base.sessions,
    };
  }
  ```

- [ ] Inside `AppProvider`, replace the `useReducer` line with a hydrate-on-mount pattern:

  ```js
  const [state, dispatch] = useReducer(reducer, defaultState);

  useEffect(() => {
    const restored = tryRestore();
    if (restored) {
      dispatch({ type: ACTIONS.HYDRATE, state: mergeRestored(defaultState, restored) });
    }
  }, []);
  ```

- [ ] Add the debounced writer effect inside `AppProvider`:

  ```js
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handle = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        if (err && err.name === "QuotaExceededError") {
          console.warn("localStorage quota exceeded");
        } else {
          console.warn("localStorage write failed", err);
        }
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [state]);
  ```

- [ ] Add the theme mirror effect inside `AppProvider`:

  ```js
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);
  ```

- [ ] Verification is deferred until the layout mounts the provider in Task 6; we will manually exercise persistence then.

- [ ] Commit:
  ```sh
  git add components/app-provider.js
  git commit -m "feat(state): persist AppProvider to localStorage and mirror theme"
  ```

---

### Task 5: Author the full agent catalog

**Files:** `data/agents.json`, `data/agents.js`, `lib/agents.js`, `scripts/smoke-agents-catalog.mjs`

Populate all five agents with every required field. The long system/evaluation prompts live verbatim in `design.md` §5; reference them inline rather than retyping.

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/data/agents.json`. Contents: a JSON array with exactly five entries whose slugs are `"recruiter"`, `"professor"`, `"investor"`, `"coding"`, `"custom"`. For every entry include these non-empty string/array fields (shapes and inline examples are inline in `design.md` §5.1–§5.5): `slug`, `name`, `role`, `duration`, `description`, `longDescription`, `scenario`, `focus`, `flow`, `previewMetrics`, `evaluationCriteria`, `systemPrompt` (see design.md §5 for full string), `evaluationPrompt` (see design.md §5 for full string), `mockEvaluation`, `contextFieldLabel`, `contextFieldDescription`, `screenShareTitle`, `screenShareHelperText`, `screenShareEmptyText`, `screenShareInstruction`. For `coding` only, also include `codingLanguages: ["JavaScript","Python","Java","C++","SQL","Pseudocode"]`, `codingQuestionBank` (the three entries shown in design.md §5.4), and `sessionKickoff` (the welcome string shown in design.md §5.4). No other agent may carry those three fields.

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/data/agents.js`:

  ```js
  import agents from "./agents.json" with { type: "json" };
  export default agents;
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/lib/agents.js`:

  ```js
  import agents from "../data/agents.js";

  export const agentSlugs = ["recruiter", "professor", "investor", "coding", "custom"];

  const bySlug = new Map(agents.map((a) => [a.slug, a]));

  export function agentBySlug(slug) {
    return bySlug.get(slug) || null;
  }

  export { agents };
  export default agents;
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/scripts/smoke-agents-catalog.mjs`:

  ```js
  import { readFileSync } from "node:fs";
  import { fileURLToPath } from "node:url";
  import { dirname, join } from "node:path";

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const file = join(__dirname, "..", "data", "agents.json");
  const agents = JSON.parse(readFileSync(file, "utf8"));

  const expectedSlugs = ["recruiter", "professor", "investor", "coding", "custom"];
  const requiredKeys = [
    "slug",
    "name",
    "role",
    "duration",
    "description",
    "longDescription",
    "scenario",
    "focus",
    "flow",
    "previewMetrics",
    "evaluationCriteria",
    "systemPrompt",
    "evaluationPrompt",
    "mockEvaluation",
    "contextFieldLabel",
    "contextFieldDescription",
    "screenShareTitle",
    "screenShareHelperText",
    "screenShareEmptyText",
    "screenShareInstruction",
  ];
  const codingOnlyKeys = ["codingLanguages", "codingQuestionBank", "sessionKickoff"];

  function assert(cond, msg) {
    if (!cond) {
      console.error("SMOKE FAIL:", msg);
      process.exit(1);
    }
  }

  assert(Array.isArray(agents), "agents.json is not an array");
  assert(agents.length === 5, `expected 5 agents, got ${agents.length}`);
  assert(
    agents
      .map((a) => a.slug)
      .sort()
      .join(",") === expectedSlugs.slice().sort().join(","),
    "slugs mismatch",
  );

  for (const a of agents) {
    for (const k of requiredKeys) {
      const v = a[k];
      assert(
        v !== undefined &&
          v !== null &&
          (typeof v !== "string" || v.length > 0) &&
          (!Array.isArray(v) || v.length > 0),
        `agent ${a.slug} missing or empty field "${k}"`,
      );
    }
    assert(
      Array.isArray(a.evaluationCriteria) && a.evaluationCriteria.length >= 4,
      `agent ${a.slug} needs >=4 evaluationCriteria items`,
    );

    if (a.slug === "coding") {
      for (const k of codingOnlyKeys) {
        assert(a[k] !== undefined, `coding agent missing "${k}"`);
      }
      assert(
        JSON.stringify(a.codingLanguages) ===
          JSON.stringify(["JavaScript", "Python", "Java", "C++", "SQL", "Pseudocode"]),
        "coding.codingLanguages mismatch",
      );
      assert(
        Array.isArray(a.codingQuestionBank) && a.codingQuestionBank.length > 0,
        "coding.codingQuestionBank empty",
      );
      assert(
        typeof a.sessionKickoff === "string" && a.sessionKickoff.length > 0,
        "coding.sessionKickoff empty",
      );
    } else {
      for (const k of codingOnlyKeys) {
        assert(a[k] === undefined, `agent ${a.slug} must not carry "${k}"`);
      }
    }
  }

  console.log("smoke-agents-catalog: OK (5 agents validated)");
  ```

- [ ] Verification — run `node scripts/smoke-agents-catalog.mjs` and confirm stdout ends with `smoke-agents-catalog: OK`.

- [ ] Commit:
  ```sh
  git add data/agents.json data/agents.js lib/agents.js scripts/smoke-agents-catalog.mjs
  git commit -m "feat(data): add five-agent catalog and smoke validator"
  ```

---

### Task 6: Root layout, global CSS tokens, mount the provider

**Files:** `app/layout.js`, `app/globals.css`

Wire the provider under `<html>`, install theme tokens, and add the font/base resets so subsequent pages have something to render against.

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/app/layout.js`:

  ```js
  import "./globals.css";
  import { AppProvider } from "../components/app-provider.js";

  export const metadata = {
    title: "Spark",
    description: "Rehearse the room before you walk in.",
  };

  export default function RootLayout({ children }) {
    return (
      <html lang="en" data-theme="dark">
        <body>
          <AppProvider>{children}</AppProvider>
        </body>
      </html>
    );
  }
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/app/globals.css`:

  ```css
  :root {
    --radius: 14px;
    --accent: #4285f4;
    --font-body: "Google Sans Text", "Segoe UI", "Helvetica Neue", system-ui, sans-serif;
    --font-mono: "SFMono-Regular", "IBM Plex Mono", "Fira Code", ui-monospace, monospace;
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 24px;
    --space-6: 32px;
    --space-7: 48px;
  }

  html[data-theme="dark"] {
    --bg: #0d1117;
    --surface: #161b22;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --border: #30363d;
    --shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  }

  html[data-theme="light"] {
    --bg: #f7f9fc;
    --surface: #ffffff;
    --text: #111418;
    --text-muted: #5a6472;
    --border: #dfe3ea;
    --shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    padding: 0;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-body);
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  a {
    color: inherit;
    text-decoration: none;
  }
  button {
    font: inherit;
    cursor: pointer;
    border: none;
    background: none;
    color: inherit;
  }
  h1,
  h2,
  h3,
  h4 {
    margin: 0;
    font-weight: 600;
    line-height: 1.2;
  }
  p {
    margin: 0;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  input,
  textarea {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: var(--space-3);
  }
  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .shell-main {
    max-width: 1120px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-5);
  }

  .shell-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .shell-brand {
    font-weight: 700;
    font-size: 1.1rem;
  }
  .shell-brand.disabled {
    cursor: default;
  }

  .toast-host {
    position: fixed;
    top: var(--space-5);
    right: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    z-index: 1000;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 240px;
    padding: var(--space-3) var(--space-4);
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  .toast.info {
    border-left: 3px solid var(--accent);
  }
  .toast.success {
    border-left: 3px solid #3fb950;
  }
  .toast.error {
    border-left: 3px solid #f85149;
  }

  .btn-primary {
    background: var(--accent);
    color: #fff;
    padding: var(--space-3) var(--space-5);
    border-radius: 10px;
    font-weight: 600;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-ghost {
    padding: var(--space-2) var(--space-3);
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-5);
  }

  .grid-agents {
    display: grid;
    gap: var(--space-5);
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  @media (max-width: 960px) {
    .grid-agents {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 720px) {
    .grid-agents {
      grid-template-columns: 1fr;
    }
    .landing-flow {
      grid-template-columns: 1fr !important;
    }
  }

  .landing-hero {
    padding: var(--space-7) 0;
    text-align: center;
  }
  .landing-hero h1 {
    font-size: 2.5rem;
    margin-bottom: var(--space-4);
  }
  .landing-hero p {
    color: var(--text-muted);
    margin-bottom: var(--space-5);
  }
  .landing-flow {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-5);
    margin-top: var(--space-6);
  }

  .pill {
    display: inline-block;
    padding: 2px var(--space-3);
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--border);
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-right: var(--space-2);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    margin-bottom: var(--space-3);
    cursor: pointer;
  }
  .row .meta {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .not-found {
    padding: var(--space-6);
    text-align: center;
    color: var(--text-muted);
  }
  ```

- [ ] Verification — run `npm run dev`, visit `http://localhost:3000`. Expect a dark background and no content yet (404). Open DevTools → Elements and confirm `<html data-theme="dark">` is present. Stop the dev server.

- [ ] Commit:
  ```sh
  git add app/layout.js app/globals.css
  git commit -m "feat(layout): mount AppProvider and install theme tokens"
  ```

---

### Task 7: Build the Shell component with header, theme toggle, and toast host

**Files:** `components/shell.js`

The shell wraps every page. Brand is non-interactive on `/`. Toasts auto-dismiss after 4s.

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/components/shell.js`:

  ```js
  "use client";

  import Link from "next/link";
  import { usePathname } from "next/navigation";
  import { useEffect } from "react";
  import { useAppActions, useAppState } from "./app-provider.js";

  function Toast({ id, message, kind }) {
    const { dismissToast } = useAppActions();
    useEffect(() => {
      const t = setTimeout(() => dismissToast(id), 4000);
      return () => clearTimeout(t);
    }, [id, dismissToast]);
    return (
      <div className={`toast ${kind}`} role="status">
        <span>{message}</span>
        <button
          className="btn-ghost"
          onClick={() => dismissToast(id)}
          aria-label="Dismiss notification"
        >
          ×
        </button>
      </div>
    );
  }

  export function Shell({ children }) {
    const { theme, toasts } = useAppState();
    const { setTheme } = useAppActions();
    const pathname = usePathname();
    const isHome = pathname === "/";

    return (
      <>
        <header className="shell-header">
          {isHome ? (
            <span className="shell-brand disabled">Spark</span>
          ) : (
            <Link href="/" className="shell-brand">
              Spark
            </Link>
          )}
          <button
            className="btn-ghost"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </header>
        <main className="shell-main">{children}</main>
        <div className="toast-host">
          {toasts.map((t) => (
            <Toast key={t.id} id={t.id} message={t.message} kind={t.kind} />
          ))}
        </div>
      </>
    );
  }

  export default Shell;
  ```

- [ ] Verification is deferred to Task 8 (first concrete page).

- [ ] Commit:
  ```sh
  git add components/shell.js
  git commit -m "feat(shell): add header, theme toggle, and toast host"
  ```

---

### Task 8: Build the landing page

**Files:** `components/landing-page.js`, `app/page.js`

Hero + three-step flow + secondary CTA.

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/components/landing-page.js`:

  ```js
  import Link from "next/link";

  export function LandingPage() {
    return (
      <>
        <section className="landing-hero">
          <h1>Spark</h1>
          <p>Rehearse the room before you walk in.</p>
          <Link href="/agents" className="btn-primary">
            View agents
          </Link>
        </section>
        <section className="landing-flow" aria-label="Three-step flow">
          <article className="card">
            <h3>Prep</h3>
            <p>Pick an agent, name a goal, share materials — a PDF, a URL, a few sentences.</p>
          </article>
          <article className="card">
            <h3>Rehearse</h3>
            <p>
              Step into a live voice session with a realistic counterpart. Share your screen if it
              helps.
            </p>
          </article>
          <article className="card">
            <h3>Review</h3>
            <p>
              Read your rubric-backed evaluation, track progress across sessions, and drill the
              gaps.
            </p>
          </article>
        </section>
        <section style={{ textAlign: "center", marginTop: "var(--space-7)" }}>
          <Link href="/agents" className="btn-primary">
            View agents
          </Link>
        </section>
      </>
    );
  }

  export default LandingPage;
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/app/page.js`:

  ```js
  import Shell from "../components/shell.js";
  import LandingPage from "../components/landing-page.js";

  export default function Page() {
    return (
      <Shell>
        <LandingPage />
      </Shell>
    );
  }
  ```

- [ ] Verification — `npm run dev`, open `http://localhost:3000`. Expect: header with "Spark" (non-interactive) + theme toggle; hero with tagline "Rehearse the room before you walk in." and a "View agents" button; three cards labeled Prep / Rehearse / Review. Click the toggle and confirm the palette flips (watch `<html data-theme>` in DevTools).

- [ ] Verification — resize browser to ~600px width. Expect: the three cards stack vertically.

- [ ] Verification — open DevTools → Application → Local Storage → `http://localhost:3000` → key `spark-state-v1`. Expect JSON containing `"theme":"light"` (or `"dark"` depending on last toggle) and empty `agents`/`threads`/`sessions`/`toasts`.

- [ ] Commit:
  ```sh
  git add components/landing-page.js app/page.js
  git commit -m "feat(landing): add landing page with hero and three-step flow"
  ```

---

### Task 9: Build the agents directory page

**Files:** `components/agents-page.js`, `app/agents/page.js`

Five-card responsive grid.

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/components/agents-page.js`:

  ```js
  import Link from "next/link";
  import agents from "../lib/agents.js";

  export function AgentsPage() {
    if (!Array.isArray(agents) || agents.length === 0) {
      return <p className="not-found">Unable to load agents</p>;
    }
    return (
      <>
        <h1 style={{ marginBottom: "var(--space-5)" }}>Agents</h1>
        <div className="grid-agents">
          {agents.map((a) => (
            <Link key={a.slug} href={`/agents/${a.slug}`} className="card" aria-label={a.name}>
              <h3>{a.name}</h3>
              <div style={{ marginTop: "var(--space-2)" }}>
                <span className="pill">{a.role}</span>
                <span className="pill">{a.duration}</span>
              </div>
              <p style={{ marginTop: "var(--space-3)", color: "var(--text-muted)" }}>
                {a.description}
              </p>
            </Link>
          ))}
        </div>
      </>
    );
  }

  export default AgentsPage;
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/app/agents/page.js`:

  ```js
  import Shell from "../../components/shell.js";
  import AgentsPage from "../../components/agents-page.js";

  export default function Page() {
    return (
      <Shell>
        <AgentsPage />
      </Shell>
    );
  }
  ```

- [ ] Verification — `npm run dev`, visit `/agents`. Expect five cards with names Recruiter Loop / Academic Defense / Investor Pitch / Coding Round / Custom Scenario, each with role + duration pills.

- [ ] Verification — at viewport widths 1440px, 1024px, 768px, 600px respectively, confirm 3 / 2 / 2 / 1 columns. (The 1024px and 768px breakpoints both fall under `max-width: 960px` so both show 2 columns.)

- [ ] Verification — click the Recruiter card. URL becomes `/agents/recruiter`. Page shows a 404 for now; that is fixed in Task 10.

- [ ] Commit:
  ```sh
  git add components/agents-page.js app/agents/page.js
  git commit -m "feat(agents): add agents directory grid"
  ```

---

### Task 10: Build the agent detail page (scenario + rubric)

**Files:** `components/agent-detail-page.js`, `app/agents/[slug]/page.js`

Scenario, long description, and collapsible rubric. Thread CRUD is added in Task 11.

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/components/agent-detail-page.js`:

  ```js
  "use client";

  import Link from "next/link";
  import { useState } from "react";
  import { agentBySlug } from "../lib/agents.js";

  export function AgentDetailPage({ slug }) {
    const agent = agentBySlug(slug);
    const [expanded, setExpanded] = useState(false);

    if (!agent) {
      return (
        <div className="not-found">
          <p>Agent not found</p>
          <Link href="/agents" className="btn-primary">
            Back to agents
          </Link>
        </div>
      );
    }

    const criteria = agent.evaluationCriteria || [];
    const visible = expanded ? criteria : criteria.slice(0, 3);

    return (
      <>
        <h1>{agent.name}</h1>
        <p style={{ color: "var(--text-muted)", marginTop: "var(--space-3)" }}>
          {agent.longDescription}
        </p>

        <section className="card" style={{ marginTop: "var(--space-5)" }}>
          <h3>Scenario</h3>
          <p style={{ marginTop: "var(--space-3)" }}>{agent.scenario}</p>
        </section>

        <section className="card" style={{ marginTop: "var(--space-5)" }}>
          <h3>Evaluation criteria</h3>
          <ul style={{ marginTop: "var(--space-3)" }}>
            {visible.map((c) => (
              <li key={c.label} style={{ marginBottom: "var(--space-3)" }}>
                <strong>{c.label}</strong>
                <div style={{ color: "var(--text-muted)" }}>{c.description}</div>
              </li>
            ))}
          </ul>
          {criteria.length > 3 && (
            <button className="btn-ghost" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </section>
      </>
    );
  }

  export default AgentDetailPage;
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/app/agents/[slug]/page.js`:

  ```js
  import Shell from "../../../components/shell.js";
  import AgentDetailPage from "../../../components/agent-detail-page.js";

  export default async function Page({ params }) {
    const { slug } = await params;
    return (
      <Shell>
        <AgentDetailPage slug={slug} />
      </Shell>
    );
  }
  ```

- [ ] Verification — `npm run dev`, visit `/agents/recruiter`. Expect: "Recruiter Loop" heading, longDescription paragraph, "Scenario" card, "Evaluation criteria" list showing the first 3 items and a "Show more" button. Click "Show more" and confirm all 5 items render; button now says "Show less".

- [ ] Verification — visit `/agents/nope`. Expect: "Agent not found" message with a "Back to agents" link that routes to `/agents`.

- [ ] Commit:
  ```sh
  git add components/agent-detail-page.js app/agents/[slug]/page.js
  git commit -m "feat(agent-detail): render scenario and rubric with show-more"
  ```

---

### Task 11: Add thread creation and thread list to the agent detail page

**Files:** `components/agent-detail-page.js`

Controlled input bound to `state.agents[slug].threadName`; list reads from `state.threads[slug]`.

- [ ] Open `components/agent-detail-page.js` and extend imports:

  ```js
  import { useRouter } from "next/navigation";
  import { useAppActions, useAppState } from "./app-provider.js";
  import { formatDateTime } from "../lib/format.js";
  ```

- [ ] Inside `AgentDetailPage`, before the not-found guard, read state + actions:

  ```js
  const { agents: agentSlices, threads } = useAppState();
  const { patchAgent, createThread, deleteThread, pushToast } = useAppActions();
  const router = useRouter();

  const agentSlice = (agent && agentSlices[agent?.slug]) || null;
  const threadName = agentSlice?.threadName || "";
  const threadList = (agent && threads[agent.slug]) || [];
  ```

  Note: move the `const agent = agentBySlug(slug);` line above these reads so `agent` is defined, keeping the not-found `return` afterward.

- [ ] Append a thread-creation + list section at the end of the returned JSX (just before the closing fragment):

  ```jsx
  <section className="card" style={{ marginTop: "var(--space-5)" }}>
    <h3>Threads</h3>
    <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
      <input
        type="text"
        placeholder="Name a new thread"
        value={threadName}
        onChange={(e) => patchAgent(agent.slug, { threadName: e.target.value })}
        style={{ flex: 1 }}
        aria-label="New thread title"
      />
      <button
        className="btn-primary"
        disabled={threadName.trim().length === 0}
        onClick={() => {
          const id = createThread(agent.slug, threadName);
          if (id) {
            patchAgent(agent.slug, { threadName: "" });
            pushToast({ message: "Thread created", kind: "success" });
          }
        }}
      >
        Create thread
      </button>
    </div>

    <ul style={{ marginTop: "var(--space-4)" }}>
      {threadList.length === 0 && (
        <li className="meta">No threads yet — create one to group practice sessions.</li>
      )}
      {[...threadList]
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
        .map((t) => (
          <li
            key={t.id}
            className="row"
            onClick={() => router.push(`/agents/${agent.slug}/threads/${t.id}`)}
          >
            <div>
              <div>
                <strong>{t.title}</strong>
              </div>
              <div className="meta">
                {formatDateTime(t.createdAt)} · {t.sessionIds.length} session
                {t.sessionIds.length === 1 ? "" : "s"}
              </div>
            </div>
            <button
              className="btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                deleteThread(agent.slug, t.id);
                pushToast({ message: "Thread deleted", kind: "info" });
              }}
              aria-label={`Delete thread ${t.title}`}
            >
              Delete
            </button>
          </li>
        ))}
    </ul>
  </section>
  ```

- [ ] Verification — `npm run dev`, visit `/agents/recruiter`. The "Create thread" button is disabled. Type `FAANG recruiter screen`; button enables. Click it. A "Thread created" toast appears top-right and auto-dismisses in ~4s. The list shows a row with the title, a formatted timestamp, and `0 sessions`.

- [ ] Verification — click the row; URL becomes `/agents/recruiter/threads/thread-…`. Use the browser back button; the thread is still in the list.

- [ ] Verification — click the `Delete` button; a "Thread deleted" toast appears and the row disappears.

- [ ] Verification — open DevTools → Application → Local Storage → `spark-state-v1`. Confirm `threads.recruiter` reflects the current state.

- [ ] Commit:
  ```sh
  git add components/agent-detail-page.js
  git commit -m "feat(agent-detail): add thread creation and thread list"
  ```

---

### Task 12: Build the thread detail page skeleton and pre-session form

**Files:** `components/thread-detail-page.js`, `app/agents/[slug]/threads/[threadId]/page.js`

Pre-session form bound to the agent slice; "Start session" wires in Task 13; sessions history renders in Task 14.

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/components/thread-detail-page.js`:

  ```js
  "use client";

  import Link from "next/link";
  import { useRouter } from "next/navigation";
  import { agentBySlug } from "../lib/agents.js";
  import { useAppActions, useAppState } from "./app-provider.js";

  export function ThreadDetailPage({ slug, threadId }) {
    const agent = agentBySlug(slug);
    const { agents: agentSlices, threads, sessions } = useAppState();
    const { patchAgent, patchThread, createSession, deleteSession, pushToast } = useAppActions();
    const router = useRouter();

    if (!agent) {
      return (
        <div className="not-found">
          <p>Agent not found</p>
          <Link href="/agents" className="btn-primary">
            Back to agents
          </Link>
        </div>
      );
    }

    const threadList = threads[slug] || [];
    const thread = threadList.find((t) => t.id === threadId) || null;

    if (!thread) {
      return (
        <div className="not-found">
          <p>Thread not found</p>
          <Link href={`/agents/${slug}`} className="btn-primary">
            Back to agent
          </Link>
        </div>
      );
    }

    const slice = agentSlices[slug] || {};
    const sessionName = slice.sessionName || "";
    const companyUrl = slice.companyUrl || "";
    const customContextText = slice.customContextText || "";

    const canStart = sessionName.trim().length > 0;

    const handlePdfUpload = () => {
      // owned by: research-and-resources
      pushToast({
        message: "PDF upload is handled in the research-and-resources feature.",
        kind: "info",
      });
    };

    return (
      <>
        <h1>{thread.title}</h1>
        <p className="meta" style={{ marginTop: "var(--space-2)" }}>
          {agent.name}
        </p>

        <section className="card" style={{ marginTop: "var(--space-5)" }}>
          <h3>Start a new session</h3>

          <label style={{ display: "block", marginTop: "var(--space-4)" }}>
            <div>Session name</div>
            <input
              type="text"
              value={sessionName}
              onChange={(e) => patchAgent(slug, { sessionName: e.target.value })}
              placeholder="e.g. First pass — behavioral warmup"
              style={{ width: "100%", marginTop: "var(--space-2)" }}
            />
          </label>

          <label style={{ display: "block", marginTop: "var(--space-4)" }}>
            <div>Company URL (optional)</div>
            <input
              type="url"
              value={companyUrl}
              onChange={(e) => patchAgent(slug, { companyUrl: e.target.value })}
              placeholder="https://example.com/careers/role"
              style={{ width: "100%", marginTop: "var(--space-2)" }}
            />
          </label>

          <label style={{ display: "block", marginTop: "var(--space-4)" }}>
            <div>{agent.contextFieldLabel}</div>
            <div className="meta" style={{ marginBottom: "var(--space-2)" }}>
              {agent.contextFieldDescription}
            </div>
            <textarea
              value={customContextText}
              onChange={(e) => patchAgent(slug, { customContextText: e.target.value })}
              rows={4}
              style={{ width: "100%" }}
            />
          </label>

          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-5)" }}>
            <button className="btn-ghost" onClick={handlePdfUpload}>
              Attach PDF (coming from research-and-resources)
            </button>
            <button
              className="btn-primary"
              disabled={!canStart}
              onClick={() => {
                // Wired in Task 13
              }}
            >
              Start session
            </button>
          </div>
        </section>
      </>
    );
  }

  export default ThreadDetailPage;
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/app/agents/[slug]/threads/[threadId]/page.js`:

  ```js
  import Shell from "../../../../../components/shell.js";
  import ThreadDetailPage from "../../../../../components/thread-detail-page.js";

  export default async function Page({ params }) {
    const { slug, threadId } = await params;
    return (
      <Shell>
        <ThreadDetailPage slug={slug} threadId={threadId} />
      </Shell>
    );
  }
  ```

- [ ] Verification — `npm run dev`, on `/agents/recruiter` create a thread, click into it. URL matches `/agents/recruiter/threads/thread-…`. Page shows the thread title, the agent name, the three form fields (the third uses "Role or team you are interviewing for" as its label), and two buttons. "Start session" is disabled.

- [ ] Verification — type `First pass` into session name; "Start session" enables (clicking it does nothing yet; wired in Task 13).

- [ ] Verification — visit `/agents/recruiter/threads/missing`. Expect "Thread not found" with a link back to the agent page.

- [ ] Commit:
  ```sh
  git add components/thread-detail-page.js app/agents/[slug]/threads/[threadId]/page.js
  git commit -m "feat(thread-detail): add pre-session form skeleton"
  ```

---

### Task 13: Wire the "Start session" flow

**Files:** `components/thread-detail-page.js`

Create a session, bump the thread's `updatedAt`, and navigate to the live-session route.

- [ ] In `components/thread-detail-page.js`, add a `handleStart` helper above the `return`:

  ```js
  const handleStart = () => {
    if (!canStart) return;
    const nowIso = new Date().toISOString();
    patchThread(slug, threadId, { updatedAt: nowIso });
    const sessionId = createSession(slug, threadId, {
      sessionName: sessionName.trim(),
      customContext: customContextText,
      upload: slice.upload || null,
    });
    if (!sessionId) {
      pushToast({ message: "Could not start session", kind: "error" });
      return;
    }
    patchAgent(slug, { sessionName: "" });
    router.push(`/session/${slug}?threadId=${threadId}&sessionId=${sessionId}`);
  };
  ```

- [ ] Replace the "Start session" `onClick={() => { /* Wired in Task 13 */ }}` with `onClick={handleStart}`.

- [ ] Verification — `npm run dev`, create a thread, open it, type `First pass` as the session name, click "Start session". URL becomes `/session/recruiter?threadId=thread-…&sessionId=session-…`. The placeholder page will render in Task 16; for now expect a 404, which is fine.

- [ ] Verification — open DevTools → Application → Local Storage → `spark-state-v1`. Confirm `sessions.recruiter` contains a session object with `id` starting with `session-`, `threadId` matching the thread, `transcript: []`, and `startedAt` populated. Confirm the owning thread's `sessionIds` array now contains the new session id and its `updatedAt` has advanced.

- [ ] Verification — click browser back; the thread detail page returns; the in-form `sessionName` is now empty.

- [ ] Commit:
  ```sh
  git add components/thread-detail-page.js
  git commit -m "feat(thread-detail): wire start-session navigation and session creation"
  ```

---

### Task 14: Render the sessions history on the thread detail page

**Files:** `components/thread-detail-page.js`

List sessions for this thread, link to the session detail page, allow deletion.

- [ ] In `components/thread-detail-page.js`, add this import near the top:

  ```js
  import { formatDateTime } from "../lib/format.js";
  ```

- [ ] Compute the session list above the `return`:

  ```js
  const sessionList = (sessions[slug] || [])
    .filter((s) => s.threadId === threadId)
    .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
  ```

- [ ] Append this section immediately after the "Start a new session" card (before the closing fragment):

  ```jsx
  <section className="card" style={{ marginTop: "var(--space-5)" }}>
    <h3>Sessions history</h3>
    {sessionList.length === 0 && (
      <p className="meta" style={{ marginTop: "var(--space-3)" }}>
        No sessions yet — start one above.
      </p>
    )}
    <ul style={{ marginTop: "var(--space-3)" }}>
      {sessionList.map((s) => (
        <li
          key={s.id}
          className="row"
          onClick={() => router.push(`/agents/${slug}/sessions/${s.id}`)}
        >
          <div>
            <div>
              <strong>{s.sessionName}</strong>
            </div>
            <div className="meta">
              {formatDateTime(s.startedAt)} · {s.durationLabel || "—"}
            </div>
          </div>
          <button
            className="btn-ghost"
            onClick={(e) => {
              e.stopPropagation();
              deleteSession(slug, s.id);
              pushToast({ message: "Session deleted", kind: "info" });
            }}
            aria-label={`Delete session ${s.sessionName}`}
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  </section>
  ```

- [ ] Verification — `npm run dev`, create a thread, start a session (end up on the `/session/…` 404 from Task 13), use browser back to return to the thread. Expect the session to appear in "Sessions history" with its name, formatted start time, and a `—` duration.

- [ ] Verification — click the session row. URL becomes `/agents/recruiter/sessions/session-…` (404 until Task 16).

- [ ] Verification — return, click `Delete` on the session row. Toast "Session deleted" appears; the row disappears; in `spark-state-v1` localStorage the session is gone and the thread's `sessionIds` no longer contains it.

- [ ] Commit:
  ```sh
  git add components/thread-detail-page.js
  git commit -m "feat(thread-detail): add sessions history list"
  ```

---

### Task 15: Add placeholder routes for session-detail and live-session pages

**Files:** `app/agents/[slug]/sessions/[sessionId]/page.js`, `app/session/[slug]/page.js`

Stop navigation from 404-ing at links handed off to later specs.

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/app/agents/[slug]/sessions/[sessionId]/page.js`:

  ```js
  import Link from "next/link";
  import Shell from "../../../../../components/shell.js";

  export default async function Page({ params }) {
    const { slug, sessionId } = await params;
    return (
      <Shell>
        <div className="not-found">
          <p>Session detail page is owned by the evaluation-engine spec.</p>
          <p className="meta">
            slug: {slug} · sessionId: {sessionId}
          </p>
          <Link href={`/agents/${slug}`} className="btn-primary">
            Back to agent
          </Link>
        </div>
      </Shell>
    );
  }
  ```

- [ ] Create `/home/ashwanth/Documents/Projects/Kiro-Spark/app/session/[slug]/page.js`:

  ```js
  import Link from "next/link";
  import Shell from "../../../components/shell.js";

  export default async function Page({ params }) {
    const { slug } = await params;
    return (
      <Shell>
        <div className="not-found">
          <p>Live session page is owned by the live-session spec.</p>
          <p className="meta">slug: {slug}</p>
          <Link href={`/agents/${slug}`} className="btn-primary">
            Back to agent
          </Link>
        </div>
      </Shell>
    );
  }
  ```

- [ ] Verification — `npm run dev`. Visit `/session/recruiter?threadId=x&sessionId=y`; expect the placeholder page with "Live session page is owned by the live-session spec." Visit `/agents/recruiter/sessions/session-abc`; expect the evaluation-engine placeholder.

- [ ] Commit:
  ```sh
  git add app/agents/[slug]/sessions/[sessionId]/page.js app/session/[slug]/page.js
  git commit -m "feat(routes): add placeholder pages for session and live-session"
  ```

---

### Task 16: End-to-end QA pass and smoke run

**Files:** none (verification only)

Walk the ten manual QA flows from `design.md` §10, run the catalog smoke, and sanity-check responsive breakpoints.

- [ ] Verification — QA 1: Fresh visit → `/` → click "View agents" → `/agents` shows five cards → click Recruiter → scenario + criteria + empty threads list → create "FAANG recruiter screen" → appears in list.

- [ ] Verification — QA 2: Open the new thread → enter session name "First pass" → click "Start session" → URL becomes `/session/recruiter?threadId=…&sessionId=…` (placeholder renders).

- [ ] Verification — QA 3: Browser back to thread → session appears in history with name and timestamp.

- [ ] Verification — QA 4: On `/agents/recruiter`, delete the thread → toast "Thread deleted" → thread gone; `spark-state-v1` shows its sessions also removed.

- [ ] Verification — QA 5: Reload `/agents/recruiter` after creating a new thread with a session → thread and session persist.

- [ ] Verification — QA 6: Click theme toggle → palette flips. Reload → theme persists; `<html data-theme>` reflects it before first paint.

- [ ] Verification — QA 7: In DevTools set `localStorage['spark-state-v1'] = '{bad json'`. Reload → app boots with defaults; console shows a single warn containing `spark-state-v1 corrupt`.

- [ ] Verification — QA 8: Visit `/agents/nope` → "Agent not found" with link back to `/agents`.

- [ ] Verification — QA 9: Visit `/agents/recruiter/threads/missing` → "Thread not found" with link back.

- [ ] Verification — QA 10: Resize to ~600px → agents grid is a single column; landing-flow cards stack.

- [ ] Verification — run `node scripts/smoke-agents-catalog.mjs` → exits 0 with `smoke-agents-catalog: OK`.

- [ ] Verification — run `npx eslint --fix app components lib data scripts` (create a minimal `.eslintrc.json` with `{ "extends": "next/core-web-vitals" }` at the repo root if one does not exist — commit only the config, not the lint output).

- [ ] Commit:
  ```sh
  git add -A
  git commit -m "chore: qa pass and lint fixes for agents-and-threads baseline" --allow-empty
  ```

---

## Contract handoff

This plan establishes the following AppProvider surface that other specs extend. None of these names or shapes should change without a coordinated spec update.

### State slices owned here (in `state`)

- `state.theme: 'dark' | 'light'`
- `state.toasts: Toast[]`
- `state.agents: Record<slug, AgentSlice>`
- `state.threads: Record<slug, ThreadRecord[]>`
- `state.sessions: Record<slug, SessionRecord[]>`

### State fields reserved for later specs (present but `null` / default here)

- `AgentSlice.researchPrep` — research-and-resources
- `AgentSlice.session` — live-session
- `AgentSlice.evaluation` — evaluation-engine
- `ThreadRecord.evaluation`, `ThreadRecord.memory` — evaluation-engine
- `SessionRecord.externalResearch`, `SessionRecord.resources` — research-and-resources
- `SessionRecord.coding` — live-session
- `SessionRecord.evaluation` — evaluation-engine
- `SessionRecord.comparison` — session-comparison

### Mutators exposed by `useAppActions()`

- `setTheme(theme)`
- `pushToast({ message, kind })` → toast id
- `dismissToast(id)`
- `patchAgent(slug, patch)`
- `createThread(slug, title)` → threadId
- `deleteThread(slug, threadId)` (cascades delete of sessions under that thread)
- `patchThread(slug, threadId, patch)`
- `createSession(slug, threadId, partial)` → sessionId (also appends id to thread, bumps thread `updatedAt`)
- `deleteSession(slug, sessionId)` (also removes id from thread's `sessionIds`)
- `patchSession(slug, sessionId, patch)`
- `appendTranscript(slug, sessionId, entry)`

### Refs reserved for later specs (on the actions object)

- `actions._jobsRef` — `useRef(new Map())` for `jobKey → AbortController`, consumed by evaluation-engine and research-and-resources.
- `actions._autoTriggerRef` — `useRef(new Set())` for idempotent auto-kickoff tracking, consumed by evaluation-engine.

### Helpers other specs import

- `generateId(type)` from `lib/ids.js`
- `formatDuration(ms)`, `formatDateTime(iso)` from `lib/format.js`
- `agents`, `agentBySlug(slug)`, `agentSlugs` from `lib/agents.js`
- `getBackendHttpUrl()`, `getBackendWsUrl()` from `lib/client-config.js`

### UI primitives

- `<Shell>` wraps every page. Other specs' pages must render inside it.
- `.card`, `.row`, `.pill`, `.btn-primary`, `.btn-ghost`, `.grid-agents`, `.toast-host` CSS utilities in `app/globals.css`.
