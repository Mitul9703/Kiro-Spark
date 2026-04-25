# Evaluation Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn finished sessions and threads into structured feedback — per-session evaluations, thread-level evaluations, hidden memory for the next session — and render the resulting report on the session and thread pages.

**Architecture:** Two stateless POST endpoints (`/api/evaluate-session`, `/api/evaluate-thread`) backed by Gemini 2.5-flash with `responseMimeType:'application/json'`. Server-side normalization clamps and reorders metrics; the weighted overall score is recomputed server-side regardless of model output. Frontend auto-triggers evaluation when a finished session has a transcript and the parent thread now has ≥2 completed sessions.

**Tech Stack:** Express 5, @google/genai, plain JavaScript, React 19 client effects with AbortController-tracked jobs.

---

## Prerequisites

This plan depends on contracts delivered by sibling specs. Do not begin until these exist in `main`:

- **AppProvider state shape and mutators** from the `agents-and-threads` plan: the reducer at `components/app-provider.js` must already expose `state.agents[slug]`, `state.threads[slug]`, `state.sessions[slug]`, the `patchSession`, `patchThread`, `createThread`, `createSession` mutators, the `jobsRef = useRef(new Map())` jobs map, the `HYDRATE` action, and the 200ms-debounced localStorage sync under key `spark-state-v1`.
- **A finished session record** produced by the `live-session` plan: each `SessionRecord` must carry a populated `transcript: TranscriptEntry[]`, an `endedAt` ISO string, an `agentSlug`, and (for the coding agent) a `coding: { finalCode, language, interviewQuestion }` block.
- **The agent catalog** in `data/agents.json`: every entry carries `evaluationPrompt` (string) and `evaluationCriteria: [{ label, description, weight? }]`. When `weight` is omitted on any criterion, the normalizer treats all weights as equal.

If any of these are missing, stop and surface the gap — do not stub them inside this feature.

---

## File Map

| Path | Purpose |
|---|---|
| `server/evaluation.js` | `evaluateSession`, `evaluateThread` Express handlers plus `composeSessionPrompt`, `composeThreadPrompt`, `normalizeSessionEvaluation`, `normalizeThreadEvaluation`, `resolveGeminiKey`, `safeSessionDefaults`, `safeThreadDefaults`, `clamp`. |
| `server.js` | Mount `POST /api/evaluate-session` and `POST /api/evaluate-thread`. |
| `components/app-provider.js` | Extend reducer + action bag with `evaluation` / `memory` slices and mutators (`startEvaluation`, `completeEvaluation`, `failEvaluation`, `retryEvaluation`, thread variants, `applyThreadMemory`). Add two auto-trigger `useEffect` loops and the unmount-abort cleanup. |
| `components/session-detail-page.js` | Replace stub with score card, rubric bars, three-column lists, resource-brief cards, transcript display, status-aware states (idle / processing / completed / failed), retry button. |
| `components/thread-detail-page.js` | Append thread-evaluation card (trajectory pill, metric-trend table, strengths/focus areas, next-session focus) and collapsed `<details>` labeled "Hidden memory — internal, used to steer next session". |
| `app/globals.css` | New tokens/rules: `.eval-card`, `.eval-score`, `.eval-metric`, `.eval-metric-bar`, `.eval-columns`, `.eval-brief`, `.transcript`, `.transcript-turn--user`, `.transcript-turn--agent`, `.thread-eval-card`, `.trend-pill--improving|stable|declining`. |
| `scripts/fixtures/recruiter-transcript.json` | Fixture transcript + context for the session smoke. |
| `scripts/fixtures/recruiter-thread.json` | Fixture thread + two pre-evaluated sessions for the thread smoke. |
| `scripts/smoke-evaluate-session.mjs` | POST the session fixture; assert shape. |
| `scripts/smoke-evaluate-thread.mjs` | POST the thread fixture; assert shape and `hiddenGuidance`. |

---

## Tasks

### Task 1 — Scaffold `server/evaluation.js` with `composeSessionPrompt`

**Files:** `server/evaluation.js` (new).

**Rationale:** Establish the module seam and the pure prompt composer before any Gemini I/O so the prompt shape can be verified cheaply.

- [ ] Create `server/evaluation.js`. Add `import { GoogleGenAI } from '@google/genai';` and `import { getAgentConfig } from '../lib/agents.js';`.
- [ ] Export stub handlers: `export async function evaluateSession(req, res) { res.status(501).json({ error: 'not implemented' }); }` and the same for `evaluateThread`.
- [ ] Add `function resolveGeminiKey() { return process.env.GEMINI_EVALUATION_API_KEY || process.env.GEMINI_API_KEY || null; }`.
- [ ] Add `function clamp(n, lo, hi) { const v = Number(n); if (!Number.isFinite(v)) return lo; return Math.min(hi, Math.max(lo, v)); }`.
- [ ] Add `function renderTranscript(transcript)` that maps `transcript` to alternating `User: <text>` / `Agent: <text>` lines separated by `\n`. Treat `role === 'system'` as `System:` but skip empty-text entries.
- [ ] Export `composeSessionPrompt({ agentConfig, transcript, upload, coding, customContext, durationLabel, startedAt, endedAt })` returning the string described in `design.md §2`. It MUST splice `agentConfig.name`, `agentConfig.evaluationPrompt`, iterate `agentConfig.evaluationCriteria` as `N. <label> — <description> (weight: <weight ?? 'equal'>)`, include `UPLOADED CONTEXT: <upload.contextText || '(none)'>`, `CUSTOM CONTEXT: <customContext || '(none)'>`, and — only when `agentConfig.slug === 'coding'` and `coding?.finalCode` is truthy — an `INTERVIEW QUESTION:` block with `coding.interviewQuestion.markdown` and a fenced code block tagged with `coding.language`.
- [ ] Append the JSON-schema instruction block verbatim from `design.md §2`.

**Verification:** `node -e "import('./server/evaluation.js').then(async m => { const agents = (await import('./data/agents.js')).default; const p = m.composeSessionPrompt({ agentConfig: agents.recruiter ?? agents[0], transcript:[{role:'user',text:'hi'},{role:'agent',text:'walk me through impact'}], upload:{contextText:''}, customContext:'', durationLabel:'2m', startedAt:0, endedAt:0 }); if (!p.includes('Recruiter') || !p.includes('weight')) throw new Error('prompt missing pieces'); console.log('OK len', p.length); })"` prints `OK len …` with no throw.

**Commit:** `evaluation: scaffold module and composeSessionPrompt`

---

### Task 2 — `normalizeSessionEvaluation(raw, agentConfig)`

**Files:** `server/evaluation.js`.

**Rationale:** The normalizer is the only place scores are authoritative. Write and verify it before wiring Gemini so malformed model output can't sneak through.

- [ ] Add `function safeSessionDefaults(agentConfig) { return { score: 0, summary: '', metrics: agentConfig.evaluationCriteria.map(c => ({ label: c.label, value: 0, justification: 'No assessment returned.' })), strengths: [], improvements: [], recommendations: [], resourceBriefs: [] }; }`.
- [ ] Export `normalizeSessionEvaluation(raw, agentConfig)`. Accept `raw` as a parsed object OR a JSON string (try/catch `JSON.parse` on strings; on parse failure return `safeSessionDefaults(agentConfig)` as-is and let the handler attach the error).
- [ ] Build `metrics` by walking `agentConfig.evaluationCriteria` in order. For each criterion, find the matching row in `raw.metrics` by case-insensitive-trimmed label; clamp `value` with `clamp(row.value, 0, 100)`, round to integer. Missing row → `{ label, value: 0, justification: 'No assessment returned.' }`.
- [ ] Recompute `score`: let `weights = criteria.map(c => Number.isFinite(c.weight) ? c.weight : 1)`, `sumW = weights.reduce((a,b)=>a+b,0)`, `score = Math.round(metrics.reduce((a, m, i) => a + m.value * weights[i], 0) / sumW)`. Always override whatever `raw.score` said.
- [ ] Coerce `summary` with `typeof raw.summary === 'string' ? raw.summary : ''`.
- [ ] For `strengths`, `improvements`, `recommendations`: `Array.isArray(raw.X) ? raw.X.filter(s => typeof s === 'string' && s.trim()).slice(0, 4) : []`.
- [ ] For `resourceBriefs`: filter to entries with non-empty `topic` and `improvement`; coerce `searchPhrases`/`resourceTypes` to arrays of strings; coerce `whyThisMatters` to string; assign `id: brief.id || \`brief-${i}\``; cap to 4.

**Verification:** Add a throwaway block in `node -e` that imports the function, calls it with `{ metrics: [{ label: 'Role fit', value: '999' }], strengths: ['a','b','c','d','e','f'], score: 42, improvements: 'not an array', resourceBriefs: [{topic:'x',improvement:'y'}] }` against the recruiter config, and asserts (a) `metrics.length === agentConfig.evaluationCriteria.length`, (b) every `metric.value` is in [0,100] and integer, (c) `strengths.length === 4`, (d) `improvements` is `[]`, (e) `score` is an integer between 0 and 100 regardless of the 42 in input. Print `NORMALIZE OK`.

**Commit:** `evaluation: normalizeSessionEvaluation with score recomputation`

---

### Task 3 — `evaluateSession` handler wired to Gemini

**Files:** `server/evaluation.js`.

**Rationale:** Replace the 501 stub with the real call chain. Errors are non-fatal: we still return HTTP 200 with safe defaults plus an `error` field so the frontend can surface a retry without a generic 500.

- [ ] Validate request: `const { agentSlug, transcript = [], upload = null, coding = null, customContext = '', durationLabel = '', startedAt = null, endedAt = null } = req.body || {};`. If `!agentSlug` or `!Array.isArray(transcript)` respond `400 { error: 'Invalid request' }`.
- [ ] `const agentConfig = getAgentConfig(agentSlug); if (!agentConfig) return res.status(400).json({ error: 'Unknown agentSlug' });`.
- [ ] `const apiKey = resolveGeminiKey(); if (!apiKey) return res.status(200).json({ evaluation: safeSessionDefaults(agentConfig), error: 'No Gemini API key' });`.
- [ ] Build the prompt via `composeSessionPrompt({...})` and call `const ai = new GoogleGenAI({ apiKey }); const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: [{ role: 'user', parts: [{ text: prompt }] }], config: { responseMimeType: 'application/json', temperature: 0.35 } });`.
- [ ] Extract JSON text: `const text = response?.text ?? response?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';`. `const parsed = JSON.parse(text);` inside a try; on throw, respond `200 { evaluation: safeSessionDefaults(agentConfig), error: 'JSON parse failed' }`.
- [ ] `const evaluation = normalizeSessionEvaluation(parsed, agentConfig); return res.json({ evaluation });`.
- [ ] Wrap the whole handler in `try { ... } catch (err) { console.error('[evaluate-session]', err); return res.status(200).json({ evaluation: safeSessionDefaults(agentConfig), error: err.message || 'Evaluation failed' }); }`.

**Verification:** `curl -s -X POST http://localhost:3000/api/evaluate-session -H 'content-type: application/json' -d '{"agentSlug":"recruiter","transcript":[{"role":"user","text":"hi"}]}' | jq '.evaluation | keys'` prints the seven expected keys (once Task 4 is done). Before Task 4, `node -e "..."` importing and invoking the handler with mock `req`/`res` is sufficient.

**Commit:** `evaluation: implement evaluateSession handler with Gemini call and safe-default fallback`

---

### Task 4 — Mount `POST /api/evaluate-session`

**Files:** `server.js`.

**Rationale:** Expose the handler through Express.

- [ ] Import: `import { evaluateSession } from './server/evaluation.js';` alongside the existing handler imports.
- [ ] Register: `app.post('/api/evaluate-session', evaluateSession);` in the same block as the other `/api/*` routes. Preserve existing route order; do not reorder or "tidy" neighbours.
- [ ] Confirm the Express JSON body parser is mounted before this route (it is via `app.use(express.json({ limit: '...' }))`). If absent, STOP — that's owned by another plan.

**Verification:** `npm run dev` then `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/evaluate-session -H 'content-type: application/json' -d '{}'` prints `400` (not 404).

**Commit:** `server: mount POST /api/evaluate-session`

---

### Task 5 — Session smoke script + fixture

**Files:** `scripts/fixtures/recruiter-transcript.json` (new), `scripts/smoke-evaluate-session.mjs` (new).

**Rationale:** Regression check without the UI. Also forces the response shape to be stable.

- [ ] Create `scripts/fixtures/recruiter-transcript.json` with `{ "agentSlug": "recruiter", "customContext": "Targeting Stripe, Payments Infra.", "durationLabel": "4m 12s", "transcript": [ { "role": "agent", "text": "Walk me through a recent impact story." }, { "role": "user", "text": "Last quarter I led a migration that cut p99 latency by 37%..." }, { "role": "agent", "text": "What was the tradeoff?" }, { "role": "user", "text": "We delayed the dashboard revamp by two weeks..." } ] }`.
- [ ] Create `scripts/smoke-evaluate-session.mjs`: `#!/usr/bin/env node` shebang, `import 'dotenv/config';`, `import fs from 'node:fs';`, read fixture, POST via `fetch` to `${process.env.SMOKE_BASE || 'http://localhost:3000'}/api/evaluate-session`.
- [ ] On `!res.ok`, `console.error('HTTP', res.status); process.exit(1);`.
- [ ] Parse the JSON body. Assert `typeof body.evaluation === 'object'`, `typeof body.evaluation.score === 'number'`, `body.evaluation.metrics.length === 4` (recruiter has 5 criteria — if the recruiter config has 5 metrics, assert `>= 4`; match the actual count in `data/agents.json` at write time). **Verify the recruiter config criterion count before hardcoding 4.**
- [ ] On mismatch: `console.error('bad shape', body); process.exit(1)`. Otherwise `console.log(JSON.stringify(body.evaluation, null, 2));`.

**Verification:** With the dev server running and `GEMINI_API_KEY` set, `node scripts/smoke-evaluate-session.mjs` exits 0 and prints an evaluation with a numeric `score`.

**Commit:** `scripts: add smoke-evaluate-session with recruiter fixture`

---

### Task 6 — `composeThreadPrompt` and `normalizeThreadEvaluation`

**Files:** `server/evaluation.js`.

**Rationale:** Mirror Tasks 1–2 for the thread evaluator. Keep it a pure helper so it's testable without Gemini.

- [ ] Export `composeThreadPrompt({ agentConfig, thread, sessions })`. Render each session oldest-first: `Session <i> — <startedAt> — overall <result.score>\n  Metrics:\n    - <label>: <value> — "<justification>"\n  Summary: <result.summary>`. Include the task/schema text from `design.md §5` verbatim, including the three-rule philosophy for `hiddenGuidance`.
- [ ] Export `safeThreadDefaults(agentConfig) { return { summary: '', trajectory: 'stable', comments: [], strengths: [], focusAreas: [], nextSessionFocus: '', metricTrends: agentConfig.evaluationCriteria.map(c => ({ label: c.label, trend: 'stable', comment: '' })), hiddenGuidance: '' }; }`.
- [ ] Export `normalizeThreadEvaluation(raw, agentConfig)`:
  - Parse string input; on failure return `safeThreadDefaults(agentConfig)`.
  - Coerce `trajectory` via `['improving','stable','declining'].includes(raw.trajectory) ? raw.trajectory : 'stable'`.
  - For `metricTrends`, walk `agentConfig.evaluationCriteria` in order; match by label (case-insensitive trim); missing → `{ label, trend: 'stable', comment: '' }`; coerce `trend` to the allowed set.
  - Clamp `comments`, `strengths`, `focusAreas` to first 4 non-empty strings.
  - Coerce `summary`, `nextSessionFocus` to strings.
  - Coerce `hiddenGuidance` to string; if empty, replace with `"Continue probing this user's weakest rubric area."`.

**Verification:** `node -e` script that calls `normalizeThreadEvaluation({ trajectory: 'nonsense', metricTrends: [], hiddenGuidance: '' }, recruiterConfig)` and asserts `trajectory === 'stable'`, `metricTrends.length === recruiterConfig.evaluationCriteria.length`, `hiddenGuidance.length > 0`. Prints `THREAD NORMALIZE OK`.

**Commit:** `evaluation: composeThreadPrompt and normalizeThreadEvaluation`

---

### Task 7 — `evaluateThread` handler

**Files:** `server/evaluation.js`.

**Rationale:** Wire the thread evaluator. Enforce the 2-session minimum at the endpoint boundary so the frontend can rely on it.

- [ ] Destructure `{ agentSlug, thread, sessions } = req.body || {}`. If `!agentSlug || !thread || !Array.isArray(sessions)` → `400 { error: 'Invalid request' }`.
- [ ] `const completed = sessions.filter(s => s?.evaluation?.status === 'completed' && s.evaluation.result); if (completed.length < 2) return res.status(400).json({ error: 'Need at least two completed session evaluations' });`.
- [ ] Resolve agent config; reject unknown slug with 400.
- [ ] Resolve Gemini key; missing key → `200 { threadEvaluation: safeThreadDefaults(agentConfig), error: 'No Gemini API key' }`.
- [ ] Build prompt with `completed` (sorted by `startedAt` ascending). Call Gemini with `model: 'gemini-2.5-flash'`, `temperature: 0.45`, `responseMimeType: 'application/json'`.
- [ ] Parse → `normalizeThreadEvaluation(parsed, agentConfig)`. Respond `{ threadEvaluation }`.
- [ ] Wrap in try/catch; on throw, return `200 { threadEvaluation: safeThreadDefaults(agentConfig), error: err.message }`.

**Verification:** `curl -X POST .../api/evaluate-thread -d '{}'` returns 400 (after Task 8 mounts it). Before mount, `node -e` with mock req/res asserts the 400 path returns when `sessions` has only one completed entry.

**Commit:** `evaluation: implement evaluateThread handler`

---

### Task 8 — Mount `POST /api/evaluate-thread` and thread smoke

**Files:** `server.js`, `scripts/fixtures/recruiter-thread.json`, `scripts/smoke-evaluate-thread.mjs`.

**Rationale:** Expose the second endpoint and verify end-to-end against a real key.

- [ ] In `server.js`, add `evaluateThread` to the existing import line and register `app.post('/api/evaluate-thread', evaluateThread);` directly under the session route.
- [ ] Create `scripts/fixtures/recruiter-thread.json` with `{ "agentSlug": "recruiter", "thread": { "id": "thread-fixture", "title": "Stripe Loop Prep", "createdAt": "2026-04-20T10:00:00Z" }, "sessions": [ /* two sessions, each with evaluation.status === 'completed' and evaluation.result carrying score + metrics + summary matching the recruiter rubric labels exactly */ ] }`. Use plausible scores (e.g., 68 → 78) so a trajectory signal is present.
- [ ] Create `scripts/smoke-evaluate-thread.mjs`: load fixture, POST to `/api/evaluate-thread`, assert `res.ok`, assert `typeof body.threadEvaluation === 'object'`, `typeof body.threadEvaluation.hiddenGuidance === 'string' && body.threadEvaluation.hiddenGuidance.length > 0`, `body.threadEvaluation.metricTrends.length === recruiterCriteriaCount`. Exit non-zero on any mismatch. Print the response.

**Verification:** `node scripts/smoke-evaluate-thread.mjs` exits 0 and prints a `threadEvaluation` with a non-empty `hiddenGuidance`.

**Commit:** `server: mount POST /api/evaluate-thread and add smoke script`

---

### Task 9 — Extend `AppProvider` state + mutators

**Files:** `components/app-provider.js`.

**Rationale:** Add the slices and action creators other tasks depend on. This is a surgical extension of the existing reducer — do not touch unrelated branches.

- [ ] In the session-record factory (or wherever `createSession` seeds a new session), add `evaluation: { status: 'idle' }` to the defaults.
- [ ] In the thread-record factory, add `evaluation: { status: 'idle' }` and `memory: null`.
- [ ] In `HYDRATE` (or the lazy init merge), for each loaded session ensure `session.evaluation ??= { status: 'idle' }`; for each thread ensure `thread.evaluation ??= { status: 'idle' }` and `thread.memory ??= null`. This protects users with existing localStorage.
- [ ] Add reducer cases: `SET_SESSION_EVALUATION` (payload: `{ slug, sessionId, patch }`) that merges `patch` into the matching session's `evaluation`. Add `SET_THREAD_EVALUATION` (payload: `{ slug, threadId, patch }`) and `SET_THREAD_MEMORY` (payload: `{ slug, threadId, memory }`).
- [ ] Add mutators to the action bag: `startEvaluation(slug, sessionId)` → dispatch patch `{ status: 'processing', startedAt: Date.now(), error: undefined, failedAt: undefined }`. `completeEvaluation(slug, sessionId, result)` → `{ status: 'completed', result, completedAt: Date.now(), error: undefined }`. `failEvaluation(slug, sessionId, error)` → `{ status: 'failed', error, failedAt: Date.now() }`. `retryEvaluation(slug, sessionId)` → `{ status: 'idle', error: undefined }`.
- [ ] Add thread variants: `startThreadEvaluation`, `completeThreadEvaluation`, `failThreadEvaluation`, `retryThreadEvaluation` following the same shape against the thread record.
- [ ] Add `applyThreadMemory(slug, threadId, { hiddenGuidance, summary, focusAreas })` → dispatch `SET_THREAD_MEMORY` with `{ hiddenGuidance, summary, focusAreas, updatedAt: Date.now() }`.

**Verification:** Load the app, open DevTools, run `localStorage.clear(); location.reload();`. After reload, in the React DevTools inspect the provider: each session has `evaluation.status === 'idle'`, each thread has `evaluation.status === 'idle'` and `memory === null`. Manually call `useAppActions().completeEvaluation('recruiter', '<existingSessionId>', { score: 42, metrics: [], summary: 'x', strengths: [], improvements: [], recommendations: [], resourceBriefs: [] })` via a temporary button or the console-exposed actions; confirm state updates.

**Commit:** `app-provider: add evaluation and memory slices plus mutators`

---

### Task 10 — Session auto-trigger effect + unmount abort

**Files:** `components/app-provider.js`.

**Rationale:** The provider is the orchestration owner. Both auto-triggers live here so the session and thread pages stay dumb.

- [ ] Inside `AppProvider`, after the mutators are defined, add `useEffect(() => { ... }, [state.sessions])` that iterates every session across every agent slug. For each session where `s.evaluation?.status === 'idle'` AND `Array.isArray(s.transcript) && s.transcript.length > 0` AND `!jobsRef.current.has('evaluation:' + s.id)`:
  - `const ctrl = new AbortController(); jobsRef.current.set('evaluation:' + s.id, ctrl);`
  - Call `startEvaluation(slug, s.id)`.
  - `fetch('/api/evaluate-session', { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentSlug: slug, transcript: s.transcript, upload: s.upload, coding: s.coding, customContext: s.customContext, durationLabel: s.durationLabel, startedAt: s.startedAt, endedAt: s.endedAt }) })`.
  - `.then(r => r.json())`. If `body.error || !body.evaluation` throw `new Error(body.error || 'Missing evaluation')`.
  - On success: `completeEvaluation(slug, s.id, body.evaluation)` then call `maybeAutoTriggerThread(slug, s.threadId)` (defined in Task 11).
  - `.catch(err => { if (err.name === 'AbortError') return; failEvaluation(slug, s.id, err.message); })`.
  - `.finally(() => jobsRef.current.delete('evaluation:' + s.id));`.
- [ ] Add the unmount cleanup once: `useEffect(() => () => { for (const c of jobsRef.current.values()) c.abort(); jobsRef.current.clear(); }, []);`. Place it adjacent to the auto-trigger effect so the intent is visible.

**Verification:** With a session that has transcript but `evaluation.status === 'idle'`, open the app and watch the Network tab: exactly one `POST /api/evaluate-session` fires. State cycles `idle → processing → completed`. Navigate between pages rapidly; no duplicate requests. Hard-refresh mid-call: the Network panel shows the in-flight request as cancelled and on reload a single new request fires.

**Commit:** `app-provider: auto-trigger session evaluation with AbortController`

---

### Task 11 — Thread auto-trigger and `applyThreadMemory`

**Files:** `components/app-provider.js`.

**Rationale:** Thread evaluation cascades from session completion. Re-fire every time so `memory.hiddenGuidance` stays current.

- [ ] Define `function maybeAutoTriggerThread(slug, threadId)` inside the provider (as a stable `useCallback`). It looks up the thread, counts sessions in `state.sessions[slug]` with `threadId === threadId && evaluation.status === 'completed'`. If `< 2`, return.
- [ ] If thread's `evaluation.status === 'processing'` AND the jobs map already has `evaluation-thread:${threadId}`, abort-and-reset: `jobsRef.current.get(key).abort(); jobsRef.current.delete(key);`. This handles re-fires when a new session completes mid-run.
- [ ] Set thread status to `idle` by calling `retryThreadEvaluation(slug, threadId)`; the dedicated `useEffect` below will pick it up.
- [ ] Add `useEffect(() => { ... }, [state.threads])` mirroring Task 10 but for threads: iterate threads; for each with `evaluation.status === 'idle'` AND at least 2 completed sessions in that thread AND `!jobsRef.current.has('evaluation-thread:' + t.id)`, register a controller, call `startThreadEvaluation(slug, t.id)`, fetch `/api/evaluate-thread` with body `{ agentSlug: slug, thread: t, sessions: state.sessions[slug].filter(s => s.threadId === t.id) }`.
- [ ] On success: `completeThreadEvaluation(slug, t.id, body.threadEvaluation)` and `applyThreadMemory(slug, t.id, { hiddenGuidance: body.threadEvaluation.hiddenGuidance, summary: body.threadEvaluation.summary, focusAreas: body.threadEvaluation.focusAreas })`.
- [ ] Abort/failure handling identical to Task 10.

**Verification:** Complete two sessions in the same thread. Watch the Network tab: after the second session's evaluation completes, a `POST /api/evaluate-thread` fires. Thread state cycles to `completed`. Inspect `state.threads[slug][i].memory`: it contains `hiddenGuidance` (non-empty), `summary`, `focusAreas`, and a numeric `updatedAt`.

**Commit:** `app-provider: auto-trigger thread evaluation and hidden-memory write`

---

### Task 12 — Session detail page: evaluation card + retry

**Files:** `components/session-detail-page.js`.

**Rationale:** Render what the orchestration produces. All four status states must be explicit.

- [ ] Read the session via `useAppState()`: find `state.sessions[slug]` → entry with `id === sessionId`. If not found, render "Session not found" with a back link to `/agents/${slug}`.
- [ ] Render a header row: session name, agent name, `durationLabel`, formatted `startedAt`.
- [ ] Branch on `session.evaluation.status`:
  - `'processing'`: render `<div className="eval-card"><div className="eval-spinner" /> <p>Generating evaluation…</p></div>`.
  - `'failed'`: render an error banner with `session.evaluation.error` and a `<button onClick={() => retryEvaluation(slug, sessionId)}>Retry evaluation</button>`.
  - `'idle'`: render a safety-net `<button onClick={() => retryEvaluation(slug, sessionId)}>Generate evaluation</button>` (auto-trigger usually pre-empts).
  - `'completed'`: render the full card.
- [ ] Completed card: score block (`<div className="eval-score">{result.score}<span>/100</span></div>` + `<p>{result.summary}</p>`), rubric section (map `result.metrics` to `<div className="eval-metric"><span className="eval-metric-label">{m.label}</span><div className="eval-metric-bar" style={{ width: m.value + '%' }} /><span className="eval-metric-value">{m.value}</span><p className="eval-metric-justification">{m.justification}</p></div>`), three-column section (`Strengths`, `Improvements`, `Recommendations` — each `result.X.slice(0,4).map(...)`), resource briefs section (`result.resourceBriefs.map(b => <article className="eval-brief">...</article>)`). Do NOT render fetched resources here — that's `research-and-resources`.

**Verification:** Open `/agents/recruiter/sessions/<completedSessionId>`. Confirm: score renders large, four/five rubric bars render with widths matching their values, three columns each have ≤ 4 bullets, resource briefs render as cards. Open a processing session: spinner renders. Force failure (temporarily throw in the handler or disable network): banner + retry renders; clicking retry flips back to processing and retries.

**Commit:** `session-detail: render evaluation card with all four status states`

---

### Task 13 — Session detail page: transcript block

**Files:** `components/session-detail-page.js`, `app/globals.css`.

**Rationale:** The report is the evaluation + the transcript side-by-side. Transcript must be scrollable and visually distinct per role.

- [ ] Below the evaluation card, render `<section className="transcript"><h2>Transcript</h2>{session.transcript.length === 0 ? <p className="transcript-empty">No transcript captured.</p> : session.transcript.map((t, i) => <div key={i} className={\`transcript-turn transcript-turn--${t.role}\`}><strong>{t.role === 'user' ? 'You' : 'Agent'}</strong><p>{t.text}</p></div>)}</section>`.
- [ ] In `app/globals.css` add: `.transcript { max-height: 60vh; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-4); }`. Add `.transcript-turn--user { background: var(--surface); margin-left: 20%; }` and `.transcript-turn--agent { background: transparent; margin-right: 20%; }` with top/bottom margins `var(--space-2)`.

**Verification:** Scroll works at >60vh of content. User turns visually distinct from agent turns (different alignment + background). Empty-transcript session shows the placeholder.

**Commit:** `session-detail: render transcript below evaluation card`

---

### Task 14 — Thread detail page: evaluation card + hidden memory

**Files:** `components/thread-detail-page.js`, `app/globals.css`.

**Rationale:** Only surface once the evaluation completes; hide guidance behind `<details>` with an explicit internal label.

- [ ] Below the existing sessions history, compute `completedCount = state.sessions[slug].filter(s => s.threadId === threadId && s.evaluation?.status === 'completed').length`.
- [ ] If `thread.evaluation.status === 'failed'`, render a small banner with `thread.evaluation.error` and a retry button wired to `retryThreadEvaluation(slug, threadId)`.
- [ ] If `thread.evaluation.status === 'completed' && completedCount >= 2`, render `<section className="thread-eval-card">`:
  - Header: `<h2>Thread progress — {completedCount} sessions</h2>`. Trajectory pill: `<span className={\`trend-pill trend-pill--${result.trajectory}\`}>{result.trajectory}</span>`.
  - Summary paragraph (`result.summary`).
  - Metric-trend table: rows from `result.metricTrends`, each with label + arrow glyph (`▲` improving / `■` stable / `▼` declining) + comment.
  - Two columns: `Recurring strengths` (`result.strengths.slice(0,4)`) and `Focus areas` (`result.focusAreas.slice(0,4)`).
  - `<p><strong>Next session focus:</strong> {result.nextSessionFocus}</p>`.
  - `<details className="thread-memory"><summary>Hidden memory — internal, used to steer next session</summary><p className="thread-memory-label">This text is not shown to you during a live session; it's used to silently steer the next agent.</p><p>{thread.memory?.hiddenGuidance}</p></details>`.
- [ ] Add CSS: `.trend-pill--improving { background: #1f7a4a; color: #fff; }`, `.trend-pill--stable { background: var(--border); color: var(--text); }`, `.trend-pill--declining { background: #b3261e; color: #fff; }`. Use only existing palette tokens where possible; the three pill colours above are the minimum new literals — if the theme already defines `--success` / `--danger`, use those instead.

**Verification:** After two completed sessions in one thread, navigate to that thread's page. Confirm: thread-progress card renders, trajectory pill colour matches the value, metric-trend rows match the rubric labels in order, `<details>` is collapsed by default, expanding it reveals the hidden guidance with the internal label. Delete one completed session → card disappears (< 2 threshold).

**Commit:** `thread-detail: render trajectory card and hidden memory disclosure`

---

### Task 15 — End-to-end manual QA

**Files:** none (QA only).

**Rationale:** The smokes cover handlers; this confirms the orchestration + UI loop under a real user flow.

- [ ] Boot the app with `GEMINI_API_KEY` set. Clear localStorage.
- [ ] Create a Recruiter thread → start a session → speak for ~90s → end session. Observe: `session.evaluation.status` transitions `idle → processing → completed` within ~30s; session detail page renders the completed card and transcript.
- [ ] Start a second session in the same thread → end it. Observe: `thread.evaluation.status` cycles likewise; the thread detail page now shows the trajectory card and the hidden-memory disclosure.
- [ ] Simulate failure: stop the Gemini key env var (or temporarily break `resolveGeminiKey` to return `null`), start a new session, end it. Observe: the session page shows the failed banner; clicking "Retry evaluation" restarts the flow (after restoring the key).
- [ ] Navigate away from the session page mid-processing. Return. Confirm: no duplicate request fires, the in-flight call either completes or was aborted cleanly (no console errors, no `setState-on-unmounted` warnings).

**Verification:** All five bullets pass without console errors.

**Commit:** no code change — do not create an empty commit.

---

## Contract handoff

Other plans consume the slices this one writes. Keep these stable — breaking changes require a coordinated update.

- **`session.evaluation.result.resourceBriefs`** — consumed by the `research-and-resources` plan. Each brief carries `{ id, topic, improvement, whyThisMatters, searchPhrases, resourceTypes }`. Research derives search inputs from `searchPhrases` and writes fetched resources back to `session.resources` (a slice this plan does NOT touch).
- **`thread.memory.hiddenGuidance`** — consumed by the `live-session` plan. The live session's system-prompt builder reads `state.threads[slug][j].memory?.hiddenGuidance` for the target thread and, when non-empty, appends it verbatim to the Gemini Live system prompt. This plan only populates `memory`; it never mutates the live prompt.
- **`session.evaluation.status` state machine** — `idle → processing → completed | failed`. Retry flips `failed → idle`. Other plans may observe but must not dispatch `SET_SESSION_EVALUATION` without using the exposed mutators.
- **Action bag additions** — `startEvaluation`, `completeEvaluation`, `failEvaluation`, `retryEvaluation`, thread variants, `applyThreadMemory`. All are stable callbacks memoized in the existing action bag.

---

## Requirements coverage

| Req | Tasks |
|---|---|
| R1 (per-session endpoint) | 1, 2, 3, 4 |
| R2 (thread endpoint) | 6, 7, 8 |
| R3 (session auto-trigger) | 9, 10 |
| R4 (thread auto-trigger) | 9, 11 |
| R5 (retry on failure) | 9, 12, 14 |
| R6 (score normalization) | 2 |
| R7 (hidden memory generation) | 6, 7, 11 |
| R8 (hidden memory consumption — contract only) | Contract handoff |
| R9 (evaluation UI states) | 12 |
| R10 (evaluation card rendering) | 12 |
| R11 (transcript display) | 13 |
| R12 (thread evaluation card) | 14 |
| R13 (abort handling on unmount) | 10, 11 |
| R14 (smoke coverage) | 5, 8 |
